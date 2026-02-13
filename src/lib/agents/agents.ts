// Agent scheduler and runner — non-remote functions
import { Cron } from 'croner';
import notifier from 'node-notifier';
import { db, agent, agentRun } from '$lib/shared/db';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import {
	writeMemoryFile,
	readMemoryFile,
	getAllMemoryFilePaths,
	searchMemoryInternal
} from '$lib/memory/memory.remote';
import { chatSimple, chatWithTools } from '$lib/chat/chat';
import type { ChatMessage } from '$lib/chat/chat';
import { getToolDefinitions, executeTool, hasTools } from '$lib/tools/tools';

// ============== TYPES ==============

interface AgentConfig {
	id: string;
	name: string;
	systemPrompt: string;
	model: string;
	memoryPath: string;
}

interface AgentRunResult {
	runId: string;
	status: 'success' | 'error';
	output: string;
	toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
	duration: number;
	error?: string;
}

interface ScheduledJob {
	cron: Cron;
	agentId: string;
	agentName: string;
}

// ============== NOTIFICATIONS ==============

function notifyAgentComplete(agentName: string, status: 'success' | 'error', summary: string) {
	const title = status === 'success' ? `✅ Agent: ${agentName}` : `❌ Agent: ${agentName}`;
	const message =
		summary.length > 200 ? summary.substring(0, 197) + '...' : summary || 'Run completed';

	try {
		notifier.notify({
			title,
			message,
			sound: status === 'error',
			timeout: 10
		});
	} catch (err) {
		console.error('Failed to send desktop notification:', err);
	}
}

// ============== AGENT SYSTEM PROMPT ==============

async function buildAgentSystemPrompt(agentConfig: AgentConfig): Promise<string> {
	let prompt = agentConfig.systemPrompt;

	prompt += `\n\n## Available Tools — USE PROACTIVELY
You have tools and should use them immediately without asking for permission or clarification.

### Tools
- search_web: Search the web. Always cite sources with URLs.
- recall_memory / save_memory: Long-term vector memory for facts and knowledge.
- create_note / read_note / list_notes: Markdown notes scoped to "${agentConfig.memoryPath}/".
- browse_url / browser_act / browser_extract / browser_screenshot / browser_close: Web browser.
- get_finances: Actual Budget - account balances, budget breakdown, transactions.
- search_email / read_email / list_emails: Gmail access (FULL READ - no permission needed).
- list_calendar_events / check_availability: Google Calendar access.
- save_recipe: Save a recipe with title, description, steps, ingredients, source URL, tags, etc.
- search_recipes: Search existing saved recipes by title, cuisine, or tags.
- create_meal_plan: Create a weekly meal plan from saved recipe IDs and auto-generate a shopping list.
- get_approved_shopping_list: Get the most recent approved shopping list with all items.
- add_to_fred_meyer_cart: Add approved shopping list items to Fred Meyer online cart via browser.
- complete_fred_meyer_order: Mark a shopping list as ordered after adding items to cart.

### Critical Rules
1. BE PROACTIVE — use tools immediately, don't ask clarifying questions
2. For email tasks: search → read → summarize (never just list and ask)
3. For purchases/orders: check finances AND search emails to cross-reference
4. Gmail/Calendar have full read access — just use them directly

## Your Memory
You have two special files:
- "${agentConfig.memoryPath}/memory.md" — Your persistent long-term memory.
- "${agentConfig.memoryPath}/temp.md" — Temporary notes for this run only.

Read memory.md first, work through your task, and update it with important findings before finishing.`;

	// Inject ATK credentials if available and agent prompt mentions ATK
	if (env.ATK_EMAIL && env.ATK_PASSWORD && agentConfig.systemPrompt.toLowerCase().includes('atk')) {
		prompt += `\n\n## America's Test Kitchen Credentials
When you need to log in to americastestkitchen.com:
- Email: ${env.ATK_EMAIL}
- Password: ${env.ATK_PASSWORD}
Use browser_act to fill in the login form. Navigate to the sign-in page first if needed.`;
	}

	// Inject Fred Meyer credentials if available and agent prompt mentions Fred Meyer
	if (
		env.FRED_MEYER_EMAIL &&
		env.FRED_MEYER_PASSWORD &&
		agentConfig.systemPrompt.toLowerCase().includes('fred meyer')
	) {
		prompt += `\n\n## Fred Meyer Credentials
When you need to log in to fredmeyer.com:
- Email: ${env.FRED_MEYER_EMAIL}
- Password: ${env.FRED_MEYER_PASSWORD}
Use browser_act to fill in the login form. Navigate to the sign-in page first if needed.`;
	}

	// Inject the agent's memory.md content
	try {
		const memoryContent = await readMemoryFile(`${agentConfig.memoryPath}/memory.md`);
		if (memoryContent && memoryContent.trim()) {
			prompt += `\n\n## Your Long-Term Memory (memory.md)\n${memoryContent}`;
		}
	} catch {
		prompt += `\n\n## Your Long-Term Memory (memory.md)\n(No memory file yet — this is likely your first run. Create one to persist state across runs.)`;
	}

	// Inject any other notes under the agent's path
	try {
		const allPaths = await getAllMemoryFilePaths(agentConfig.memoryPath);
		const otherPaths = allPaths.filter(
			(p) =>
				p !== `${agentConfig.memoryPath}/memory.md` && p !== `${agentConfig.memoryPath}/temp.md`
		);

		if (otherPaths.length > 0) {
			if (otherPaths.length <= 5) {
				const contents: string[] = [];
				for (const p of otherPaths) {
					try {
						const content = await readMemoryFile(p);
						if (content.trim()) {
							contents.push(`### ${p}\n${content}`);
						}
					} catch {
						// skip
					}
				}
				if (contents.length > 0) {
					prompt += `\n\n## Your Other Notes\n${contents.join('\n\n')}`;
				}
			} else {
				prompt += `\n\n## Your Other Notes\nYou have ${otherPaths.length} note files. Use list_notes and read_note to access them.`;
			}
		}
	} catch {
		// No additional notes
	}

	// Search vector store for context
	try {
		const memories = await searchMemoryInternal({
			query: agentConfig.name + ' ' + agentConfig.systemPrompt.slice(0, 200),
			limit: 3
		});
		if (memories.length > 0) {
			const memoryText = memories
				.map((m) => {
					const similarity = Math.round((1 - m.distance) * 100);
					return `- (${similarity}% match, ${m.type}) ${m.content}`;
				})
				.join('\n');
			prompt += `\n\n## Related Context from Vector Memory\n${memoryText}`;
		}
	} catch {
		// Vector search unavailable
	}

	return prompt;
}

// ============== AGENT JOB RUNNER ==============

const MAX_TOOL_ITERATIONS = 999; // Effectively unlimited — constrained by MAX_RUN_TIME_MS instead
const MAX_RETRIES = 2;
const MAX_RUN_TIME_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TOOL_RESULT_CHARS = 4000; // Truncate tool results to prevent context overflow
const MAX_IMAGE_MESSAGES = 2; // Only keep the N most recent screenshot messages
const MAX_NUDGE_COUNT = 5; // Maximum times to nudge a stalled agent

/**
 * Estimate message array size in characters (rough proxy for tokens).
 * Used to decide when to trim context.
 */
function estimateContextSize(messages: unknown[]): number {
	return JSON.stringify(messages).length;
}

/**
 * Trim old image/screenshot messages from the array, keeping only the N most recent.
 * This prevents base64 screenshots from filling the context window.
 */
function trimImageMessages(messages: unknown[], maxImages: number): void {
	const imageIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i] as Record<string, unknown>;
		if (msg.role === 'user' && Array.isArray(msg.content)) {
			const hasImage = (msg.content as Array<Record<string, unknown>>).some(
				(c) => c.type === 'image_url'
			);
			if (hasImage) imageIndices.push(i);
		}
	}
	// Remove all but the last maxImages image messages
	const toRemove = imageIndices.slice(0, Math.max(0, imageIndices.length - maxImages));
	for (let i = toRemove.length - 1; i >= 0; i--) {
		messages.splice(toRemove[i], 1);
	}
}

/**
 * Build a compressed summary of what the agent has accomplished so far,
 * for use when restarting context after a nudge.
 */
function buildProgressSummary(toolCallLog: AgentRunResult['toolCalls'], agentName: string): string {
	const savedRecipes = toolCallLog.filter((t) => t.tool === 'save_recipe');
	const mealPlanCalls = toolCallLog.filter((t) => t.tool === 'create_meal_plan');
	const browseCalls = toolCallLog.filter(
		(t) => t.tool === 'browse_url' || t.tool === 'browser_extract'
	);

	let summary = `## Progress So Far\n`;
	summary += `- Total tool calls made: ${toolCallLog.length}\n`;

	if (savedRecipes.length > 0) {
		summary += `- Recipes saved (${savedRecipes.length}):\n`;
		for (const r of savedRecipes) {
			const title = (r.args as Record<string, unknown>).title || 'Unknown';
			summary += `  - "${title}"\n`;
		}
	} else {
		summary += `- Recipes saved: 0\n`;
	}

	if (mealPlanCalls.length > 0) {
		summary += `- Meal plan created: YES\n`;
	} else {
		summary += `- Meal plan created: NO — you MUST call create_meal_plan before finishing\n`;
	}

	summary += `- Pages browsed: ${browseCalls.length}\n`;

	// Include recipe IDs from save_recipe results
	const recipeIds: string[] = [];
	for (const r of savedRecipes) {
		const match = r.result.match(/id["\s:]+(\d+)/i);
		if (match) recipeIds.push(match[1]);
	}
	if (recipeIds.length > 0) {
		summary += `- Saved recipe IDs: ${recipeIds.join(', ')}\n`;
	}

	return summary;
}

export async function runAgentJob(agentConfig: AgentConfig): Promise<AgentRunResult> {
	const startTime = Date.now();
	const toolCallLog: AgentRunResult['toolCalls'] = [];

	// Create the run record
	const [run] = await db
		.insert(agentRun)
		.values({
			agentId: agentConfig.id,
			status: 'running',
			startedAt: new Date()
		})
		.returning();

	// Update agent status
	await db
		.update(agent)
		.set({ lastRunAt: new Date(), lastRunStatus: 'running' })
		.where(eq(agent.id, agentConfig.id));

	try {
		// Clear temp.md
		const tempPath = `${agentConfig.memoryPath}/temp.md`;
		await writeMemoryFile({
			path: tempPath,
			content: `# Run: ${new Date().toISOString()}\nAgent: ${agentConfig.name}\nRun ID: ${run.id}\n\n---\n\n`
		});

		// Build system prompt
		const systemPrompt = await buildAgentSystemPrompt(agentConfig);
		const tools = hasTools() ? getToolDefinitions() : [];

		// Start the conversation
		let messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{
				role: 'user',
				content:
					'Execute your scheduled task now. Read your memory.md first, then proceed with your work. When done, update memory.md with any findings or state changes.'
			}
		];

		let fullContent = '';
		let nudgeCount = 0;

		if (tools.length === 0) {
			const completion = await chatSimple(messages, agentConfig.model);
			const content = completion.choices?.[0]?.message?.content;
			fullContent = typeof content === 'string' ? content : '';
		} else {
			// Tool-calling loop
			for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
				// Check time limit
				if (Date.now() - startTime > MAX_RUN_TIME_MS) {
					console.warn(
						`⏰ Agent ${agentConfig.name} hit 30-minute time limit at iteration ${iteration}`
					);
					fullContent += '\n\n[Agent run stopped: 30-minute time limit reached]';
					break;
				}

				// Trim screenshots to prevent context overflow
				trimImageMessages(messages as unknown[], MAX_IMAGE_MESSAGES);

				// Log context size periodically
				if (iteration % 5 === 0) {
					const ctxSize = estimateContextSize(messages);
					console.log(
						`  📊 Agent ${agentConfig.name} iteration ${iteration}: ${messages.length} messages, ~${Math.round(ctxSize / 1024)}KB context, ${toolCallLog.length} tool calls`
					);
				}

				let completion;
				let lastError = '';

				for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
					if (attempt > 0) {
						await new Promise((r) => setTimeout(r, attempt * 3000));
					}
					try {
						completion = await chatWithTools(messages, agentConfig.model, tools);
						break;
					} catch (err) {
						lastError = err instanceof Error ? err.message : 'API call failed';
						console.error(
							`Agent ${agentConfig.name} API attempt ${attempt + 1} failed:`,
							lastError
						);
					}
				}

				if (!completion) {
					throw new Error(`API call failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
				}

				const choice = completion.choices?.[0];
				if (!choice) {
					console.warn(
						`  ⚠️ Agent ${agentConfig.name} got empty choices at iteration ${iteration}`
					);
					break;
				}

				const messageContent = choice.message?.content;
				const content = typeof messageContent === 'string' ? messageContent : '';
				if (content) fullContent += content;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const toolCalls = (choice.message as any)?.toolCalls as
					| Array<{
							id: string;
							type: string;
							function: { name: string; arguments: string };
					  }>
					| undefined;

				if (!toolCalls || toolCalls.length === 0) {
					console.log(
						`  💬 Agent ${agentConfig.name} responded without tool calls at iteration ${iteration}. Content: "${content.substring(0, 100)}..."`
					);

					// Model stopped calling tools — check if it actually finished the job
					const hasCalledCreateMealPlan = toolCallLog.some((t) => t.tool === 'create_meal_plan');
					const savedRecipeCount = toolCallLog.filter((t) => t.tool === 'save_recipe').length;

					if (
						agentConfig.name === 'Meal Planner' &&
						(!hasCalledCreateMealPlan || savedRecipeCount < 5) &&
						nudgeCount < MAX_NUDGE_COUNT &&
						Date.now() - startTime < MAX_RUN_TIME_MS - 60000
					) {
						nudgeCount++;

						// Build what's missing
						const missing: string[] = [];
						if (savedRecipeCount < 5)
							missing.push(
								`only ${savedRecipeCount}/5 recipes saved — you need ${5 - savedRecipeCount} more`
							);
						if (!hasCalledCreateMealPlan)
							missing.push(
								'create_meal_plan was never called — you MUST call it with the saved recipe IDs'
							);

						// FRESH CONTEXT RESTART — compress the conversation to avoid context overflow
						const progressSummary = buildProgressSummary(toolCallLog, agentConfig.name);
						const nudgePrompt = `YOU ARE NOT DONE (nudge ${nudgeCount}/${MAX_NUDGE_COUNT}). Your task is incomplete:\n- ${missing.join('\n- ')}\n\n${progressSummary}\n\nContinue working NOW. Call your tools immediately. Do NOT explain what you will do — just DO it.\n${savedRecipeCount < 3 ? 'NEXT STEP: Browse americastestkitchen.com to find another recipe. Navigate to a recipe page, extract the content, and call save_recipe.' : savedRecipeCount < 5 ? 'NEXT STEP: Generate an AI recipe. Call save_recipe directly with a creative recipe you invent (40 min or less, no grill, no sub-recipes).' : 'NEXT STEP: Call create_meal_plan with the saved recipe IDs to create a weekly meal plan.'}`;

						// Reset messages with fresh context instead of accumulating forever
						messages = [
							{ role: 'system', content: systemPrompt },
							{ role: 'user', content: nudgePrompt }
						] as ChatMessage[];

						console.log(
							`🔄 Agent ${agentConfig.name} nudge ${nudgeCount}/${MAX_NUDGE_COUNT}: ${savedRecipeCount}/5 recipes, meal plan: ${hasCalledCreateMealPlan}. FRESH CONTEXT RESTART.`
						);
						continue;
					}

					if (agentConfig.name === 'Meal Planner' && nudgeCount >= MAX_NUDGE_COUNT) {
						console.warn(
							`⚠️ Agent ${agentConfig.name} hit max nudge count (${MAX_NUDGE_COUNT}). Accepting partial results.`
						);
					}

					break;
				}

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const assistantMsg: any = {
					role: 'assistant',
					content: content || null,
					toolCalls: toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: {
							name: tc.function.name,
							arguments: tc.function.arguments
						}
					}))
				};
				messages.push(assistantMsg);

				for (const tc of toolCalls) {
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(tc.function.arguments);
					} catch {
						args = {};
					}

					console.log(`  🔧 Agent ${agentConfig.name} calling tool: ${tc.function.name}`);

					const toolResult = await executeTool(tc.function.name, args);

					toolCallLog.push({
						tool: tc.function.name,
						args,
						result: toolResult.content.substring(0, 500)
					});

					try {
						const tempContent = await readMemoryFile(tempPath);
						await writeMemoryFile({
							path: tempPath,
							content:
								tempContent +
								`\n## Tool: ${tc.function.name}\nArgs: ${JSON.stringify(args)}\nResult: ${toolResult.content.substring(0, 300)}\n\n`
						});
					} catch {
						// Non-critical
					}

					// Truncate tool result content to prevent context overflow
					const truncatedContent =
						toolResult.content.length > MAX_TOOL_RESULT_CHARS
							? toolResult.content.substring(0, MAX_TOOL_RESULT_CHARS) +
								`\n\n[...truncated from ${toolResult.content.length} chars]`
							: toolResult.content;

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const toolResponseMsg: any = {
						role: 'tool',
						content: truncatedContent,
						toolCallId: tc.id
					};

					// If images were returned, add them as a separate user message
					// (tool messages only support string content)
					if (toolResult.images?.length) {
						const imageMsg: any = {
							role: 'user',
							content: [
								{
									type: 'text',
									text: `[Screenshot from ${tc.function.name} tool - analyze this image]`
								},
								...toolResult.images.map((img) => ({
									type: 'image_url',
									imageUrl: { url: `data:${img.mimeType};base64,${img.base64}` }
								}))
							]
						};
						messages.push(imageMsg);
					}
					messages.push(toolResponseMsg);
				}
			}
		}

		const duration = Date.now() - startTime;

		await db
			.update(agentRun)
			.set({
				status: 'success',
				output: fullContent,
				toolCalls: JSON.stringify(toolCallLog),
				duration,
				completedAt: new Date()
			})
			.where(eq(agentRun.id, run.id));

		await db
			.update(agent)
			.set({ lastRunAt: new Date(), lastRunStatus: 'success', updatedAt: new Date() })
			.where(eq(agent.id, agentConfig.id));

		notifyAgentComplete(
			agentConfig.name,
			'success',
			fullContent.substring(0, 200) || 'Run completed successfully'
		);

		console.log(
			`✅ Agent ${agentConfig.name} completed in ${duration}ms (${toolCallLog.length} tool calls)`
		);

		return {
			runId: run.id,
			status: 'success',
			output: fullContent,
			toolCalls: toolCallLog,
			duration
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';

		await db
			.update(agentRun)
			.set({
				status: 'error',
				output: '',
				error: errorMsg,
				duration,
				completedAt: new Date()
			})
			.where(eq(agentRun.id, run.id));

		await db
			.update(agent)
			.set({ lastRunAt: new Date(), lastRunStatus: 'error', updatedAt: new Date() })
			.where(eq(agent.id, agentConfig.id));

		notifyAgentComplete(agentConfig.name, 'error', `Error: ${errorMsg}`);

		console.error(`❌ Agent ${agentConfig.name} failed after ${duration}ms:`, errorMsg);

		return {
			runId: run.id,
			status: 'error',
			output: '',
			toolCalls: toolCallLog,
			duration,
			error: errorMsg
		};
	}
}

// ============== SCHEDULER ==============

class AgentScheduler {
	private jobs = new Map<string, ScheduledJob>();
	private initialized = false;

	async init() {
		if (this.initialized) return;
		this.initialized = true;

		console.log('🤖 Agent Scheduler: Initializing...');

		try {
			const agents = await db.query.agent.findMany({
				where: eq(agent.enabled, true)
			});

			for (const a of agents) {
				this.scheduleAgent(a);
			}

			console.log(`🤖 Agent Scheduler: ${agents.length} agent(s) scheduled`);
		} catch (error) {
			console.error('🤖 Agent Scheduler: Failed to initialize:', error);
		}
	}

	scheduleAgent(agentConfig: {
		id: string;
		name: string;
		systemPrompt: string;
		cronSchedule: string;
		model: string;
		memoryPath: string;
	}) {
		this.removeAgent(agentConfig.id);

		// Skip scheduling if no cron expression (triggered manually/programmatically)
		if (!agentConfig.cronSchedule || !agentConfig.cronSchedule.trim()) {
			console.log(
				`  🤖 "${agentConfig.name}" has no cron schedule — available for manual/programmatic triggering only`
			);
			return;
		}

		try {
			const cron = new Cron(agentConfig.cronSchedule, async () => {
				console.log(
					`🤖 Agent "${agentConfig.name}" triggered by schedule: ${agentConfig.cronSchedule}`
				);
				try {
					await runAgentJob({
						id: agentConfig.id,
						name: agentConfig.name,
						systemPrompt: agentConfig.systemPrompt,
						model: agentConfig.model,
						memoryPath: agentConfig.memoryPath
					});
				} catch (error) {
					console.error(`🤖 Agent "${agentConfig.name}" job failed:`, error);
				}
			});

			this.jobs.set(agentConfig.id, {
				cron,
				agentId: agentConfig.id,
				agentName: agentConfig.name
			});

			const nextRun = cron.nextRun();
			console.log(
				`  ⏰ "${agentConfig.name}" scheduled: ${agentConfig.cronSchedule} (next: ${nextRun?.toLocaleString() || 'unknown'})`
			);
		} catch (error) {
			console.error(`🤖 Failed to schedule agent "${agentConfig.name}":`, error);
		}
	}

	removeAgent(agentId: string) {
		const existing = this.jobs.get(agentId);
		if (existing) {
			existing.cron.stop();
			this.jobs.delete(agentId);
			console.log(`🤖 Agent "${existing.agentName}" unscheduled`);
		}
	}

	async updateAgent(agentId: string) {
		const agentData = await db.query.agent.findFirst({
			where: eq(agent.id, agentId)
		});

		if (!agentData) {
			this.removeAgent(agentId);
			return;
		}

		if (agentData.enabled) {
			this.scheduleAgent(agentData);
		} else {
			this.removeAgent(agentId);
		}
	}

	async runNow(agentId: string): Promise<void> {
		const agentData = await db.query.agent.findFirst({
			where: eq(agent.id, agentId)
		});

		if (!agentData) {
			throw new Error(`Agent not found: ${agentId}`);
		}

		console.log(`🤖 Agent "${agentData.name}" manually triggered`);

		await runAgentJob({
			id: agentData.id,
			name: agentData.name,
			systemPrompt: agentData.systemPrompt,
			model: agentData.model,
			memoryPath: agentData.memoryPath
		});
	}

	async runByName(agentName: string): Promise<void> {
		const agentData = await db.query.agent.findFirst({
			where: eq(agent.name, agentName)
		});

		if (!agentData) {
			throw new Error(`Agent not found by name: ${agentName}`);
		}

		console.log(`🤖 Agent "${agentData.name}" triggered by name`);

		await runAgentJob({
			id: agentData.id,
			name: agentData.name,
			systemPrompt: agentData.systemPrompt,
			model: agentData.model,
			memoryPath: agentData.memoryPath
		});
	}

	getStatus(): Array<{
		agentId: string;
		agentName: string;
		nextRun: Date | null;
		isRunning: boolean;
	}> {
		return Array.from(this.jobs.values()).map((job) => ({
			agentId: job.agentId,
			agentName: job.agentName,
			nextRun: job.cron.nextRun(),
			isRunning: job.cron.isRunning()
		}));
	}

	stopAll() {
		for (const job of this.jobs.values()) {
			job.cron.stop();
		}
		this.jobs.clear();
		console.log('🤖 Agent Scheduler: All jobs stopped');
	}
}

// Singleton — survives HMR in dev
const globalForScheduler = globalThis as unknown as { agentScheduler: AgentScheduler };
export const scheduler = globalForScheduler.agentScheduler || new AgentScheduler();
globalForScheduler.agentScheduler = scheduler;

// Tool exports moved to agent-tools.ts to avoid circular imports
export { askAgentTool, listAgentsTool } from './agent-tools';
