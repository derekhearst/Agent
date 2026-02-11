// Agents module — CRUD, scheduling, notifications, and non-streaming agent runner
import { z } from 'zod';
import { query, command } from '$app/server';
import { db, agent, agentRun } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';
import { Cron } from 'croner';
import notifier from 'node-notifier';
import {
	writeMemoryFile,
	readMemoryFile,
	getAllMemoryFilePaths,
	searchMemoryInternal
} from '$lib/memory/memory.remote';
import { chatSimple, chatWithTools } from '$lib/chat/chat.remote';
import type { ChatMessage } from '$lib/chat/chat.remote';
import { getToolDefinitions, executeTool, hasTools } from '$lib/tools/tools';

// ============== PRIVATE: NOTIFICATIONS ==============

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

// ============== PRIVATE: SCHEDULER ==============

interface ScheduledJob {
	cron: Cron;
	agentId: string;
	agentName: string;
}

class AgentScheduler {
	private jobs = new Map<string, ScheduledJob>();
	private initialized = false;

	/** Initialize the scheduler — load all enabled agents and start their cron jobs */
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

	/** Schedule a single agent's cron job */
	scheduleAgent(agentConfig: {
		id: string;
		name: string;
		systemPrompt: string;
		cronSchedule: string;
		model: string;
		memoryPath: string;
	}) {
		// Remove existing job if any
		this.removeAgent(agentConfig.id);

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

	/** Remove an agent's cron job */
	removeAgent(agentId: string) {
		const existing = this.jobs.get(agentId);
		if (existing) {
			existing.cron.stop();
			this.jobs.delete(agentId);
			console.log(`🤖 Agent "${existing.agentName}" unscheduled`);
		}
	}

	/** Update an agent's schedule (remove + re-add) */
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

	/** Manually trigger an agent run */
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

	/** Get info about all scheduled jobs */
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

	/** Stop all cron jobs */
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

// ============== PRIVATE: AGENT RUNNER ==============

const MAX_TOOL_ITERATIONS = 8;
const MAX_RETRIES = 2;

interface AgentConfig {
	id: string;
	name: string;
	systemPrompt: string;
	model: string;
	memoryPath: string; // e.g. "agent/taskname"
}

interface AgentRunResult {
	runId: string;
	status: 'success' | 'error';
	output: string;
	toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
	duration: number;
	error?: string;
}

/**
 * Build a system prompt scoped to a specific agent's memory path.
 */
async function buildAgentSystemPrompt(agentConfig: AgentConfig): Promise<string> {
	let prompt = agentConfig.systemPrompt;

	// Add tool usage instructions
	prompt += `\n\n## Available Tools
You have access to the following tools:
- search_web: Search the web for current information. Always cite sources with URLs.
- recall_memory: Search vector memory for past knowledge and conversations.
- save_memory: Save important facts to vector memory.
- create_note: Create/update markdown notes. Your notes are scoped to your memory path: "${agentConfig.memoryPath}/".
- read_note: Read a specific note file.
- list_notes: Browse available note files.
- browse_url: Navigate to a URL in a web browser and get page content + screenshot.
- browser_act: Perform an action on the browser page (click, type, scroll, etc.).
- browser_extract: Extract specific information from the current browser page.
- browser_screenshot: Take a screenshot of the current browser page.
- browser_close: Close the browser session when done.
- get_finances: Retrieve a read-only financial overview from Actual Budget — account balances, budget breakdown, and recent transactions. Use when asked about finances, spending, budget, or money. Optionally pass a month (YYYY-MM) and/or days of transactions.

For browsing tasks, use browse_url to navigate, then browser_act to interact. You'll receive screenshots showing page state.

## Your Memory
You have two special files:
- "${agentConfig.memoryPath}/memory.md" — Your persistent long-term memory. Read this at the start of each run to recall past work.
- "${agentConfig.memoryPath}/temp.md" — Temporary notes for this run only. This is cleared at the start of each run.

Always read your memory.md first, then work through your task, and update memory.md with any important findings or state changes before finishing.`;

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

	// Search vector store for context relevant to the agent's description
	try {
		const memories = await searchMemoryInternal(
			agentConfig.name + ' ' + agentConfig.systemPrompt.slice(0, 200),
			3
		);
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

/**
 * Run an agent job (non-streaming). Used by the scheduler.
 * Returns the full result including output, tool calls, and timing.
 */
async function runAgentJob(agentConfig: AgentConfig): Promise<AgentRunResult> {
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
		await writeMemoryFile(
			tempPath,
			`# Run: ${new Date().toISOString()}\nAgent: ${agentConfig.name}\nRun ID: ${run.id}\n\n---\n\n`
		);

		// Build system prompt
		const systemPrompt = await buildAgentSystemPrompt(agentConfig);
		const tools = hasTools() ? getToolDefinitions() : [];

		// Start the conversation with a "go" message
		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{
				role: 'user',
				content:
					'Execute your scheduled task now. Read your memory.md first, then proceed with your work. When done, update memory.md with any findings or state changes.'
			}
		];

		let fullContent = '';

		if (tools.length === 0) {
			// Simple non-streaming call
			const completion = await chatSimple(messages, agentConfig.model);
			const content = completion.choices?.[0]?.message?.content;
			fullContent = typeof content === 'string' ? content : '';
		} else {
			// Tool-calling loop
			for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
				let completion;
				let lastError = '';

				// Retry logic
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
				if (!choice) break;

				const messageContent = choice.message?.content;
				const content = typeof messageContent === 'string' ? messageContent : '';
				if (content) fullContent += content;

				// Check for tool calls
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const toolCalls = (choice.message as any)?.toolCalls as
					| Array<{
							id: string;
							type: string;
							function: { name: string; arguments: string };
					  }>
					| undefined;

				if (!toolCalls || toolCalls.length === 0) {
					// No tool calls, model is done
					break;
				}

				// Build assistant message with tool calls
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

				// Execute each tool
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
						result: toolResult.content.substring(0, 500) // Truncate for log
					});

					// Append to temp.md
					try {
						const tempContent = await readMemoryFile(tempPath);
						await writeMemoryFile(
							tempPath,
							tempContent +
								`\n## Tool: ${tc.function.name}\nArgs: ${JSON.stringify(args)}\nResult: ${toolResult.content.substring(0, 300)}\n\n`
						);
					} catch {
						// Non-critical
					}

					// Build tool response — with vision content if images are present
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const toolResponseMsg: any = {
						role: 'tool',
						content: toolResult.images?.length
							? [
									{ type: 'text', text: toolResult.content },
									...toolResult.images.map((img) => ({
										type: 'image_url',
										image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
									}))
								]
							: toolResult.content,
						toolCallId: tc.id
					};
					messages.push(toolResponseMsg);
				}
			}
		}

		const duration = Date.now() - startTime;

		// Update run record
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

		// Update agent status
		await db
			.update(agent)
			.set({ lastRunAt: new Date(), lastRunStatus: 'success', updatedAt: new Date() })
			.where(eq(agent.id, agentConfig.id));

		// Send notification
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

		// Update run record with error
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

		// Update agent status
		await db
			.update(agent)
			.set({ lastRunAt: new Date(), lastRunStatus: 'error', updatedAt: new Date() })
			.where(eq(agent.id, agentConfig.id));

		// Send error notification
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

// ============== PRIVATE: DELETE MEMORY FILE ==============

async function deleteMemoryPath(relativePath: string): Promise<void> {
	const { dev } = await import('$app/environment');
	const { rm, stat } = await import('node:fs/promises');
	const { join } = await import('node:path');

	function getMemoryDir(): string {
		if (dev) {
			return join(process.cwd(), '.storage', 'memory');
		}
		return '/app/memory';
	}

	const MEMORY_DIR = getMemoryDir();
	const fullPath = join(MEMORY_DIR, relativePath);

	try {
		const stats = await stat(fullPath);
		if (stats.isDirectory()) {
			await rm(fullPath, { recursive: true });
		}
	} catch {
		// Directory may not exist
	}
}

// ============== QUERIES ==============

export const getAgents = query(async () => {
	const agents = await db.query.agent.findMany({
		orderBy: [desc(agent.updatedAt)],
		with: {
			runs: {
				orderBy: [desc(agentRun.startedAt)],
				limit: 1
			}
		}
	});

	const schedulerStatus = scheduler.getStatus();
	const statusMap = new Map(schedulerStatus.map((s) => [s.agentId, s]));

	return agents.map((a) => ({
		...a,
		lastRun: a.runs[0] || null,
		nextRun: statusMap.get(a.id)?.nextRun?.toISOString() || null,
		isScheduled: statusMap.has(a.id)
	}));
});

export const getAgentById = query(z.string(), async (id) => {
	const agentData = await db.query.agent.findFirst({
		where: eq(agent.id, id),
		with: {
			runs: {
				orderBy: [desc(agentRun.startedAt)],
				limit: 20
			}
		}
	});

	if (!agentData) throw new Error('Agent not found');

	const status = scheduler.getStatus().find((s) => s.agentId === id);

	return {
		...agentData,
		nextRun: status?.nextRun?.toISOString() || null,
		isScheduled: !!status
	};
});

const agentRunsSchema = z.object({
	id: z.string(),
	limit: z.number().optional().default(20),
	offset: z.number().optional().default(0)
});

export const getAgentRuns = query(agentRunsSchema, async ({ id, limit, offset }) => {
	return await db.query.agentRun.findMany({
		where: eq(agentRun.agentId, id),
		orderBy: [desc(agentRun.startedAt)],
		limit,
		offset
	});
});

// ============== COMMANDS ==============

const createAgentSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional().default(''),
	systemPrompt: z.string().min(1),
	cronSchedule: z.string().min(1),
	model: z.string().optional().default('openrouter/auto'),
	enabled: z.boolean().optional().default(true)
});

export const createAgent = command(createAgentSchema, async (data) => {
	const slug = data.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const memoryPath = `agent/${slug}`;

	try {
		const [newAgent] = await db
			.insert(agent)
			.values({
				name: data.name,
				description: data.description,
				systemPrompt: data.systemPrompt,
				cronSchedule: data.cronSchedule,
				model: data.model,
				memoryPath,
				enabled: data.enabled
			})
			.returning();

		// Initialize memory files
		await writeMemoryFile(
			`${memoryPath}/memory.md`,
			`# ${data.name} — Long-Term Memory\n\nCreated: ${new Date().toISOString()}\n\n## Notes\n\n`
		);
		await writeMemoryFile(
			`${memoryPath}/temp.md`,
			`# ${data.name} — Temp Notes\n\n(Cleared at each run start)\n`
		);

		// Schedule if enabled
		if (newAgent.enabled) {
			scheduler.scheduleAgent(newAgent);
		}

		await getAgents().refresh();
		return newAgent;
	} catch (error) {
		if (error instanceof Error && error.message.includes('UNIQUE')) {
			throw new Error('An agent with that name already exists');
		}
		throw error;
	}
});

const updateAgentSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	systemPrompt: z.string().optional(),
	cronSchedule: z.string().optional(),
	model: z.string().optional(),
	enabled: z.boolean().optional()
});

export const updateAgent = command(updateAgentSchema, async (data) => {
	const existing = await db.query.agent.findFirst({
		where: eq(agent.id, data.id)
	});
	if (!existing) throw new Error('Agent not found');

	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt;
	if (data.cronSchedule !== undefined) updateData.cronSchedule = data.cronSchedule;
	if (data.model !== undefined) updateData.model = data.model;
	if (data.enabled !== undefined) updateData.enabled = data.enabled;

	const [updated] = await db.update(agent).set(updateData).where(eq(agent.id, data.id)).returning();

	await scheduler.updateAgent(data.id);
	await getAgents().refresh();
	await getAgentById(data.id).refresh();
	return updated;
});

export const deleteAgent = command(z.string(), async (id) => {
	const existing = await db.query.agent.findFirst({
		where: eq(agent.id, id)
	});
	if (!existing) throw new Error('Agent not found');

	scheduler.removeAgent(id);
	await db.delete(agent).where(eq(agent.id, id));

	try {
		await deleteMemoryPath(existing.memoryPath);
	} catch {
		// Memory dir may not exist
	}

	await getAgents().refresh();
	return { success: true };
});

export const runAgentNow = command(z.string(), async (id) => {
	scheduler.runNow(id).catch((err) => {
		console.error('Manual agent run failed:', err);
	});
	return { success: true, message: 'Agent run started' };
});

// ============== AI-ASSISTED AGENT SETUP ==============

const SETUP_SYSTEM_PROMPT = `You are an AI agent configuration assistant. The user will describe a task they want automated on a schedule. Your job is to generate a complete agent configuration.

You MUST respond with ONLY a valid JSON object (no markdown code fences, no explanation) with these fields:
{
  "name": "short-slug-name (lowercase, hyphens, no spaces, max 30 chars)",
  "description": "One-line human-readable description of what this agent does",
  "systemPrompt": "The full system prompt for the agent. Be detailed and specific. Include: what the agent should do each run, what tools to use, how to organize findings, what to save to memory. Write this as instructions TO the agent.",
  "cronSchedule": "A valid cron expression (e.g. '0 9 * * *' for daily at 9am, '*/30 * * * *' for every 30 min)",
  "cronHuman": "Human-readable description of the schedule (e.g. 'Every day at 9:00 AM', 'Every 30 minutes')",
  "model": "openrouter/auto"
}

Guidelines for the systemPrompt field:
- Write it as direct instructions to the AI agent
- Tell it to ALWAYS read its memory.md first
- Tell it what information to look for / tasks to perform
- Tell it how to organize and save findings to its notes
- Tell it to update memory.md with a summary of what was done
- If it's a monitoring/research agent, tell it what to search for
- Be specific about output format and what constitutes important findings
- The agent has tools: search_web, recall_memory, save_memory, create_note, read_note, list_notes

Guidelines for cronSchedule:
- Use standard cron format: minute hour day-of-month month day-of-week
- "every hour" → "0 * * * *"
- "every 30 minutes" → "*/30 * * * *"
- "daily at 9am" → "0 9 * * *"
- "every monday at 8am" → "0 8 * * 1"
- "twice daily" → "0 9,18 * * *"
- Be conservative — most tasks don't need to run more than hourly`;

const generateConfigSchema = z.object({
	description: z.string().min(1),
	model: z.string().optional().default('openrouter/auto')
});

export const generateAgentConfig = command(generateConfigSchema, async ({ description, model }) => {
	const messages: ChatMessage[] = [
		{ role: 'system', content: SETUP_SYSTEM_PROMPT },
		{ role: 'user', content: `Create an agent configuration for: ${description}` }
	];

	const completion = await chatSimple(messages, model);
	const content = completion.choices?.[0]?.message?.content;

	if (typeof content !== 'string') {
		throw new Error('Failed to generate configuration');
	}

	// Parse the JSON response — handle possible markdown code fences
	let jsonStr = content.trim();
	if (jsonStr.startsWith('```')) {
		jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
	}

	const config = JSON.parse(jsonStr);

	if (!config.name || !config.systemPrompt || !config.cronSchedule) {
		throw new Error('AI generated incomplete configuration');
	}

	return config;
});
