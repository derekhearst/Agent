// Actual Budget Tool — financial overview and modification from Actual Budget
import { env } from '$env/dynamic/private';
import type { ToolHandler, ToolExecuteResult } from '$lib/tools/tools';
import * as api from '@actual-app/api';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(tmpdir(), 'actual-budget-cache');

/** Format an Actual integer amount to a human-readable currency string */
function formatAmount(intAmount: number): string {
	const value = api.utils.integerToAmount(intAmount);
	return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Get the current month in YYYY-MM format */
function getCurrentMonth(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Get a date N days ago in YYYY-MM-DD format */
function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString().split('T')[0];
}

interface AccountInfo {
	id: string;
	name: string;
	offbudget: boolean;
	closed: boolean;
}

interface CategoryInfo {
	id: string;
	name: string;
	group_id: string;
	is_income: boolean;
}

interface CategoryGroupInfo {
	id: string;
	name: string;
	is_income: boolean;
	categories: CategoryInfo[];
}

interface TransactionInfo {
	id: string;
	date: string;
	amount: number;
	payee_name?: string;
	payee?: string;
	notes?: string;
	category?: string;
}

interface BudgetMonthCat {
	id: string;
	name: string;
	budgeted: number;
	spent: number;
	balance: number;
}

interface BudgetMonthGroup {
	id: string;
	name: string;
	budgeted: number;
	spent: number;
	balance: number;
	categories: BudgetMonthCat[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BudgetMonthRaw = Record<string, any>;

// ============== HELPER: API CONNECTION ==============

async function withBudgetApi<T>(fn: () => Promise<T>): Promise<T> {
	const serverURL = env.ACTUAL_SERVER_URL;
	const password = env.ACTUAL_PASSWORD;
	const syncId = env.ACTUAL_SYNC_ID;

	if (!serverURL || !password || !syncId) {
		throw new Error('Actual Budget is not configured. Missing environment variables.');
	}

	mkdirSync(DATA_DIR, { recursive: true });

	try {
		await api.init({ serverURL, password, dataDir: DATA_DIR });
		await api.downloadBudget(syncId, { password });
		return await fn();
	} finally {
		try {
			await api.shutdown();
		} catch {
			// Ignore shutdown errors
		}
	}
}

// ============== GET FINANCES (READ-ONLY) ==============

async function getFinancialOverview(month?: string, days: number = 30): Promise<ToolExecuteResult> {
	try {
		return await withBudgetApi(async () => {
			const targetMonth = month || getCurrentMonth();
			const startDate = daysAgo(days);
			const endDate = new Date().toISOString().split('T')[0];

			// Fetch all data in parallel
			const [accounts, categories, , budgetMonth, payees] = await Promise.all([
				api.getAccounts() as Promise<AccountInfo[]>,
				api.getCategories() as Promise<CategoryInfo[]>,
				api.getCategoryGroups() as Promise<CategoryGroupInfo[]>,
				api.getBudgetMonth(targetMonth) as Promise<BudgetMonthRaw>,
				api.getPayees() as Promise<Array<{ id: string; name: string }>>
			]);

			// Build payee lookup
			const payeeMap = new Map(payees.map((p) => [p.id, p.name]));

			// Build category lookup
			const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

			// Get active (non-closed) accounts
			const activeAccounts = accounts.filter((a) => !a.closed);

			// Fetch balances and transactions for each active account
			const accountBalances = await Promise.all(
				activeAccounts.map((a) => api.getAccountBalance(a.id) as Promise<number>)
			);

			const accountTransactions = await Promise.all(
				activeAccounts.map(
					(a) => api.getTransactions(a.id, startDate, endDate) as Promise<TransactionInfo[]>
				)
			);

			// ---- Build the markdown response ----
			const sections: string[] = [];

			// === ACCOUNTS & BALANCES ===
			sections.push('## 💰 Accounts & Balances\n');
			let totalOnBudget = 0;
			let totalOffBudget = 0;

			for (let i = 0; i < activeAccounts.length; i++) {
				const acct = activeAccounts[i];
				const balance = accountBalances[i];
				const label = acct.offbudget ? '(off-budget)' : '';
				sections.push(`- **${acct.name}** ${label}: ${formatAmount(balance)}`);

				if (acct.offbudget) {
					totalOffBudget += balance;
				} else {
					totalOnBudget += balance;
				}
			}

			sections.push('');
			sections.push(`**Total On-Budget:** ${formatAmount(totalOnBudget)}`);
			if (totalOffBudget !== 0) {
				sections.push(`**Total Off-Budget:** ${formatAmount(totalOffBudget)}`);
			}
			sections.push(`**Net Worth:** ${formatAmount(totalOnBudget + totalOffBudget)}`);

			// === BUDGET OVERVIEW ===
			sections.push(`\n## 📊 Budget Overview — ${targetMonth}\n`);

			const groups = (budgetMonth?.categoryGroups ?? []) as BudgetMonthGroup[];
			for (const group of groups) {
				if (!group.categories || group.categories.length === 0) continue;

				sections.push(`### ${group.name}`);
				sections.push('| Category | Budgeted | Spent | Balance |');
				sections.push('|----------|----------|-------|---------|');

				let groupBudgeted = 0;
				let groupSpent = 0;
				let groupBalance = 0;

				for (const cat of group.categories) {
					const budgeted = cat.budgeted ?? 0;
					const spent = cat.spent ?? 0;
					const balance = cat.balance ?? 0;
					groupBudgeted += budgeted;
					groupSpent += spent;
					groupBalance += balance;

					sections.push(
						`| ${cat.name} | ${formatAmount(budgeted)} | ${formatAmount(spent)} | ${formatAmount(balance)} |`
					);
				}

				sections.push(
					`| **${group.name} Total** | **${formatAmount(groupBudgeted)}** | **${formatAmount(groupSpent)}** | **${formatAmount(groupBalance)}** |`
				);
				sections.push('');
			}

			// === RECENT TRANSACTIONS ===
			sections.push(`\n## 🧾 Recent Transactions (last ${days} days)\n`);

			for (let i = 0; i < activeAccounts.length; i++) {
				const acct = activeAccounts[i];
				const txns = accountTransactions[i];

				if (!txns || txns.length === 0) continue;

				// Sort by date descending, take top 15 per account
				const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

				sections.push(`### ${acct.name}`);
				sections.push('| Date | Payee | Amount | Category | Notes | ID |');
				sections.push('|------|-------|--------|----------|-------|----|');

				for (const t of sorted) {
					const payeeName = t.payee ? (payeeMap.get(t.payee) ?? '—') : '—';
					const catName = t.category ? (categoryMap.get(t.category) ?? '—') : '—';
					const notes = t.notes ?? '';
					sections.push(
						`| ${t.date} | ${payeeName} | ${formatAmount(t.amount)} | ${catName} | ${notes} | ${t.id} |`
					);
				}
				sections.push('');
			}

			return { content: sections.join('\n') };
		});
	} catch (error) {
		console.error('Actual Budget tool error:', error);
		return {
			content: `Error fetching financial data: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const getFinancesTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'get_finances',
			description:
				'Retrieve a financial overview from Actual Budget. Returns account balances, budget category breakdown for a given month (budgeted vs spent vs balance), and recent transactions with their IDs. Use when the user asks about their finances, spending, budget, account balances, or money.',
			parameters: {
				type: 'object',
				properties: {
					month: {
						type: 'string',
						description:
							'The budget month to view in YYYY-MM format (e.g. "2026-02"). Defaults to the current month.'
					},
					days: {
						type: 'number',
						description: 'How many days of recent transactions to include. Defaults to 30.'
					}
				},
				required: []
			}
		}
	},
	execute: async (args) => {
		const month = args.month as string | undefined;
		const days = (args.days as number) ?? 30;
		return getFinancialOverview(month, days);
	}
};

// ============== CREATE CATEGORY (DIRECT EXECUTION) ==============

async function createCategory(
	categoryName: string,
	groupName: string
): Promise<ToolExecuteResult> {
	try {
		return await withBudgetApi(async () => {
			// Find the category group
			const groups = (await api.getCategoryGroups()) as CategoryGroupInfo[];
			const group = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());

			if (!group) {
				return {
					content: `Error: Category group "${groupName}" not found. Available groups: ${groups.map((g) => g.name).join(', ')}`
				};
			}

			// Check if category already exists
			const categories = (await api.getCategories()) as CategoryInfo[];
			const existing = categories.find(
				(c) => c.name.toLowerCase() === categoryName.toLowerCase() && c.group_id === group.id
			);

			if (existing) {
				return {
					content: `Category "${categoryName}" already exists in group "${groupName}". No action needed.`
				};
			}

			// Create the category
			const newCategoryId = await api.createCategory({
				name: categoryName,
				group_id: group.id
			});
			await api.sync();

			return {
				content: `✅ Created category "${categoryName}" in group "${groupName}" (ID: ${newCategoryId})`
			};
		});
	} catch (error) {
		console.error('Error creating category:', error);
		return {
			content: `Error creating category: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const createCategoryTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'create_budget_category',
			description:
				'Create a new budget category in Actual Budget. IMPORTANT: Always confirm with the user before calling this tool. This directly creates the category.',
			parameters: {
				type: 'object',
				properties: {
					category_name: {
						type: 'string',
						description: 'The name of the new category to create (e.g. "Electronics", "Pet Supplies")'
					},
					group_name: {
						type: 'string',
						description:
							'The name of the category group to add the category to (e.g. "Fixed Costs", "Flexible Costs", "Income")'
					}
				},
				required: ['category_name', 'group_name']
			}
		}
	},
	execute: async (args) => {
		const categoryName = args.category_name as string;
		const groupName = args.group_name as string;
		return createCategory(categoryName, groupName);
	}
};

// ============== ASSIGN CATEGORY TO TRANSACTION (DIRECT EXECUTION) ==============

async function assignCategory(
	transactionId: string,
	categoryName: string
): Promise<ToolExecuteResult> {
	try {
		return await withBudgetApi(async () => {
			// Find the category
			const categories = (await api.getCategories()) as CategoryInfo[];
			const category = categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());

			if (!category) {
				return {
					content: `Error: Category "${categoryName}" not found. Available categories: ${categories.map((c) => c.name).join(', ')}`
				};
			}

			// Update the transaction
			await api.updateTransaction(transactionId, {
				category: category.id
			});
			await api.sync();

			return {
				content: `✅ Assigned transaction ${transactionId} to category "${categoryName}"`
			};
		});
	} catch (error) {
		console.error('Error assigning category:', error);
		return {
			content: `Error assigning category: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const assignCategoryTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'assign_transaction_category',
			description:
				'Assign a transaction to a different category in Actual Budget. IMPORTANT: Always confirm with the user before calling this tool. Use get_finances first to get transaction IDs.',
			parameters: {
				type: 'object',
				properties: {
					transaction_id: {
						type: 'string',
						description: 'The ID of the transaction to re-categorize (from get_finances results)'
					},
					category_name: {
						type: 'string',
						description: 'The name of the category to assign the transaction to'
					}
				},
				required: ['transaction_id', 'category_name']
			}
		}
	},
	execute: async (args) => {
		const transactionId = args.transaction_id as string;
		const categoryName = args.category_name as string;
		return assignCategory(transactionId, categoryName);
	}
};

// ============== UPDATE TRANSACTION NOTES (DIRECT EXECUTION) ==============

async function updateNotes(
	transactionId: string,
	notes: string
): Promise<ToolExecuteResult> {
	try {
		return await withBudgetApi(async () => {
			// Update the transaction notes
			await api.updateTransaction(transactionId, {
				notes: notes
			});
			await api.sync();

			return {
				content: `✅ Updated notes for transaction ${transactionId}: "${notes}"`
			};
		});
	} catch (error) {
		console.error('Error updating transaction notes:', error);
		return {
			content: `Error updating transaction notes: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

export const updateTransactionNotesTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'update_transaction_notes',
			description:
				'Update the notes/memo field of a transaction in Actual Budget. Use get_finances first to get transaction IDs.',
			parameters: {
				type: 'object',
				properties: {
					transaction_id: {
						type: 'string',
						description: 'The ID of the transaction to update (from get_finances results)'
					},
					notes: {
						type: 'string',
						description: 'The new notes/memo text for the transaction'
					}
				},
				required: ['transaction_id', 'notes']
			}
		}
	},
	execute: async (args) => {
		const transactionId = args.transaction_id as string;
		const notes = args.notes as string;
		return updateNotes(transactionId, notes);
	}
};
