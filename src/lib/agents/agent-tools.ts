// Agent tools — separated to avoid circular imports with tools.ts
import { db, agent, agentRun } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';
import { readMemoryFile, searchMemoryInternal } from '$lib/memory/memory.remote';
import type { ToolHandler } from '$lib/tools/tools';

/** Build context about a specific agent for querying */
async function getAgentContext(
	agentData: typeof agent.$inferSelect,
	question?: string
): Promise<{ content: string }> {
	const parts: string[] = [];

	parts.push(`## Agent: ${agentData.name}`);
	parts.push(`Description: ${agentData.description}`);
	parts.push(`Schedule: ${agentData.cronSchedule}`);
	parts.push(`Status: ${agentData.enabled ? 'Enabled' : 'Disabled'}`);
	parts.push(
		`Last run: ${agentData.lastRunAt ? agentData.lastRunAt.toLocaleString() : 'Never'} (${agentData.lastRunStatus || 'N/A'})`
	);

	// Get memory.md
	try {
		const memory = await readMemoryFile(`${agentData.memoryPath}/memory.md`);
		if (memory.trim()) {
			parts.push(`\n### Agent Memory\n${memory}`);
		}
	} catch {
		parts.push(`\n### Agent Memory\n(No memory file yet)`);
	}

	// Get last run output
	const lastRun = await db.query.agentRun.findFirst({
		where: eq(agentRun.agentId, agentData.id),
		orderBy: [desc(agentRun.startedAt)]
	});

	if (lastRun?.output) {
		const output =
			lastRun.output.length > 1000 ? lastRun.output.substring(0, 1000) + '...' : lastRun.output;
		parts.push(`\n### Latest Run Output\n${output}`);
	}

	// If there's a specific question, search vector memory
	if (question) {
		try {
			const memories = await searchMemoryInternal({
				query: question,
				limit: 3
			});

			if (memories.length > 0) {
				parts.push(`\n### Related Memory (for: "${question}")`);
				for (const m of memories) {
					parts.push(`- ${m.content} (distance: ${m.distance.toFixed(2)})`);
				}
			}
		} catch {
			// Skip if vector search fails
		}
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
