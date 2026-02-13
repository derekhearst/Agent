// Agents module — Remote functions (query/command) only
import { z } from 'zod';
import { query, command } from '$app/server';
import { db, agent, agentRun } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';
import { writeMemoryFile } from '$lib/memory/memory.remote';
import { chatSimple } from '$lib/chat/chat';
import type { ChatMessage } from '$lib/chat/chat';
import { scheduler } from '$lib/agents/agents';
import { deleteMemoryPath } from '$lib/memory/memory.remote';

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
	cronSchedule: z.string().default(''),
	model: z.string().optional().default('moonshotai/kimi-k2.5'),
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
		await writeMemoryFile({
			path: `${memoryPath}/memory.md`,
			content: `# ${data.name} — Long-Term Memory\n\nCreated: ${new Date().toISOString()}\n\n## Notes\n\n`
		});
		await writeMemoryFile({
			path: `${memoryPath}/temp.md`,
			content: `# ${data.name} — Temp Notes\n\n(Cleared at each run start)\n`
		});

		// Schedule if enabled (guard for empty cron handled inside scheduleAgent)
		if (newAgent.enabled) {
			try {
				scheduler.scheduleAgent(newAgent);
			} catch (schedErr) {
				console.warn(
					`⚠️ Agent "${newAgent.name}" created but scheduling failed (cron: "${newAgent.cronSchedule}"):`,
					schedErr
				);
			}
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

	try {
		await scheduler.updateAgent(data.id);
	} catch (schedErr) {
		console.warn(`⚠️ Agent "${updated.name}" updated but re-scheduling failed:`, schedErr);
	}
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
  "model": "moonshotai/kimi-k2.5"
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
	model: z.string().optional().default('moonshotai/kimi-k2.5')
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
