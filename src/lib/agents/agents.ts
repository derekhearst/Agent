// Agent scheduler and runner — non-remote functions
import { Cron } from 'croner';
import notifier from 'node-notifier';
import { db, agent, agentRun } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';
import {
	writeMemoryFile,
	readMemoryFile,
	getAllMemoryFilePaths,
	searchMemoryInternal
} from '$lib/memory/memory.remote';
import { chatSimple, chatWithTools } from '$lib/chat/chat';
import type { ChatMessage } from '$lib/chat/chat';
import { getToolDefinitions, executeTool, hasTools, type ToolHandler } from '$lib/tools/tools';

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
- get_finances: Retrieve a read-only financial overview from Actual Budget — account balances, budget breakdown, and recent transactions. Use when asked about finances, spending, budget, or money.

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

const MAX_TOOL_ITERATIONS = 8;
const MAX_RETRIES = 2;

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
			const completion = await chatSimple(messages, agentConfig.model);
			const content = completion.choices?.[0]?.message?.content;
			fullContent = typeof content === 'string' ? content : '';
		} else {
			// Tool-calling loop
			for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
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
				if (!choice) break;

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

// ============== TOOL HANDLERS ==============

async function getAgentContext(
	agentData: {
		id: string;
		name: string;
		description: string;
		memoryPath: string;
		cronSchedule: string;
		enabled: boolean;
		lastRunAt: Date | null;
		lastRunStatus: string | null;
	},
	question?: string
): Promise<{ content: string }> {
	const parts: string[] = [];

	// Agent info
	parts.push(`## Agent: ${agentData.name}`);
	parts.push(`Description: ${agentData.description}`);
	parts.push(`Schedule: ${agentData.cronSchedule}`);
	parts.push(`Enabled: ${agentData.enabled ? 'Yes' : 'No'}`);
	parts.push(
		`Last run: ${agentData.lastRunAt ? agentData.lastRunAt.toLocaleString() : 'Never'} (${agentData.lastRunStatus || 'N/A'})`
	);

	// Read memory.md
	try {
		const memory = await readMemoryFile(`${agentData.memoryPath}/memory.md`);
		if (memory.trim()) {
			parts.push(`\n### Long-Term Memory\n${memory}`);
		}
	} catch {
		parts.push('\n### Long-Term Memory\n(No memory file yet)');
	}

	// Read temp.md (latest run notes)
	try {
		const temp = await readMemoryFile(`${agentData.memoryPath}/temp.md`);
		if (temp.trim()) {
			parts.push(`\n### Latest Run Notes\n${temp}`);
		}
	} catch {
		// No temp file
	}

	// Get last 3 runs
	const recentRuns = await db.query.agentRun.findMany({
		where: eq(agentRun.agentId, agentData.id),
		orderBy: [desc(agentRun.startedAt)],
		limit: 3
	});

	if (recentRuns.length > 0) {
		parts.push('\n### Recent Runs');
		for (const run of recentRuns) {
			const duration = run.duration ? `${(run.duration / 1000).toFixed(1)}s` : 'N/A';
			const output = run.output
				? run.output.substring(0, 500) + (run.output.length > 500 ? '...' : '')
				: run.error || 'No output';
			parts.push(
				`\n**${run.startedAt?.toLocaleString()}** — ${run.status} (${duration})\n${output}`
			);
		}
	}

	if (question) {
		parts.push(`\n---\nUser's question about this agent: ${question}`);
	}

	return { content: parts.join('\n') };
}

/** ask_agent — query a specific agent's memory and recent activity */
export const askAgentTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'ask_agent',
			description:
				"Query a scheduled agent's memory, recent run output, and status. Use this to check what an agent has been working on, its latest findings, or its current state.",
			parameters: {
				type: 'object',
				properties: {
					agentName: {
						type: 'string',
						description:
							'The name of the agent to query (e.g., "news-monitor", "research-assistant")'
					},
					question: {
						type: 'string',
						description:
							'Optional specific question to focus the context retrieval. If omitted returns general status.'
					}
				},
				required: ['agentName']
			}
		}
	},
	async execute(args) {
		const agentName = args.agentName as string;
		const question = args.question as string | undefined;

		// Find the agent
		const agentData = await db.query.agent.findFirst({
			where: eq(agent.name, agentName)
		});

		if (!agentData) {
			// Try fuzzy match
			const allAgents = await db.query.agent.findMany();
			const match = allAgents.find(
				(a) =>
					a.name.toLowerCase().includes(agentName.toLowerCase()) ||
					a.description.toLowerCase().includes(agentName.toLowerCase())
			);

			if (!match) {
				const names = allAgents.map((a) => a.name).join(', ');
				return {
					content: `Agent "${agentName}" not found. Available agents: ${names || 'none'}`
				};
			}

			return await getAgentContext(match, question);
		}

		return await getAgentContext(agentData, question);
	}
};

/** list_agents — list all configured agents */
export const listAgentsTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'list_agents',
			description:
				'List all scheduled AI agents with their names, descriptions, schedules, and current status.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	async execute() {
		const agents = await db.query.agent.findMany({
			orderBy: [desc(agent.updatedAt)]
		});

		if (agents.length === 0) {
			return { content: 'No agents configured. Create agents in the Agents tab.' };
		}

		const lines = agents.map((a) => {
			const status = a.enabled ? '🟢' : '⚪';
			const lastRun = a.lastRunAt ? a.lastRunAt.toLocaleString() : 'Never';
			return `${status} **${a.name}** — ${a.description}\n   Schedule: ${a.cronSchedule} | Last run: ${lastRun} (${a.lastRunStatus || 'N/A'})`;
		});

		return { content: `## Scheduled Agents (${agents.length})\n\n${lines.join('\n\n')}` };
	}
};
