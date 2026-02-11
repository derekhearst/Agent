// Agent query tools — ask_agent and list_agents for main chat integration
import type { ToolHandler } from '$lib/tools/tools';
import { db, agent, agentRun } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';
import { readMemoryFile } from '$lib/memory/memory.remote';

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
