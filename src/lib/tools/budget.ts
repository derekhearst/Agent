// Actual Budget Tool — read-only financial overview from Actual Budget
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

async function getFinancialOverview(
	month?: string,
	days: number = 30
): Promise<ToolExecuteResult> {
	const serverURL = env.ACTUAL_SERVER_URL;
	const password = env.ACTUAL_PASSWORD;
	const syncId = env.ACTUAL_SYNC_ID;

	if (!serverURL || !password || !syncId) {
		return {
			content:
				'Error: Actual Budget is not configured. Missing ACTUAL_SERVER_URL, ACTUAL_PASSWORD, or ACTUAL_SYNC_ID environment variables.'
		};
	}

	// Ensure cache directory exists
	mkdirSync(DATA_DIR, { recursive: true });

	try {
		// Connect & load budget
		await api.init({ serverURL, password, dataDir: DATA_DIR });
		await api.downloadBudget(syncId, { password });

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
			sections.push('| Date | Payee | Amount | Category | Notes |');
			sections.push('|------|-------|--------|----------|-------|');

			for (const t of sorted) {
				const payeeName = t.payee ? (payeeMap.get(t.payee) ?? '—') : '—';
				const catName = t.category ? (categoryMap.get(t.category) ?? '—') : '—';
				const notes = t.notes ?? '';
				sections.push(
					`| ${t.date} | ${payeeName} | ${formatAmount(t.amount)} | ${catName} | ${notes} |`
				);
			}
			sections.push('');
		}

		return { content: sections.join('\n') };
	} catch (error) {
		console.error('Actual Budget tool error:', error);
		return {
			content: `Error fetching financial data: ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	} finally {
		try {
			await api.shutdown();
		} catch {
			// Shutdown errors are non-critical
		}
	}
}

export const getFinancesTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'get_finances',
			description:
				'Retrieve a read-only financial overview from Actual Budget. Returns account balances, budget category breakdown for a given month (budgeted vs spent vs balance), and recent transactions. Use when the user asks about their finances, spending, budget, account balances, or money.',
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
						description:
							'How many days of recent transactions to include. Defaults to 30.'
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
