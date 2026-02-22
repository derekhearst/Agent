// DM Assistant module — Remote functions (query/command) for campaign management
import { z } from 'zod';
import { query, command } from '$app/server';
import {
	db,
	vectorClient,
	dmCampaign,
	dmSource,
	dmSession,
	dmFaction,
	dmConsequence,
	dmQuest,
	dmItem,
	dmNpc,
	dmPartyMember,
	dmLocation,
	dmCalendarEvent,
	chatSession,
	message
} from '$lib/shared/db';
import { desc, eq, asc } from 'drizzle-orm';
import { storeChunks, searchMemoryInternal } from '$lib/memory/memory.remote';
import { chatSimple } from '$lib/chat/chat';
import type { ChatMessage } from '$lib/chat/chat';

// ============== CAMPAIGNS ==============

export const getCampaigns = query(async () => {
	const campaigns = await db.query.dmCampaign.findMany({
		orderBy: [desc(dmCampaign.updatedAt)],
		with: {
			sessions: {
				orderBy: [desc(dmSession.sessionNumber)],
				limit: 1
			},
			sources: true
		}
	});

	return campaigns.map((c) => ({
		...c,
		sessionCount: c.sessions.length > 0 ? c.sessions[0].sessionNumber : 0,
		lastSession: c.sessions[0] || null,
		hasSourceBooks: c.sources.length > 0
	}));
});

export const getCampaignById = query(z.string(), async (id) => {
	const campaign = await db.query.dmCampaign.findFirst({
		where: eq(dmCampaign.id, id),
		with: {
			sources: true,
			sessions: { orderBy: [desc(dmSession.sessionNumber)] },
			factions: { orderBy: [asc(dmFaction.name)] },
			consequences: { orderBy: [desc(dmConsequence.createdAt)] },
			quests: { orderBy: [asc(dmQuest.title)] },
			items: { orderBy: [asc(dmItem.name)] },
			npcs: { orderBy: [asc(dmNpc.name)] },
			partyMembers: { orderBy: [asc(dmPartyMember.characterName)] },
			locations: { orderBy: [asc(dmLocation.name)] },
			calendarEvents: { orderBy: [asc(dmCalendarEvent.gameDay)] }
		}
	});
	if (!campaign) throw new Error('Campaign not found');
	return campaign;
});

const createCampaignSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional().default('')
});

export const createCampaign = command(createCampaignSchema, async (data) => {
	// Create a campaign-level chat session for lore questions
	const [campaignChat] = await db
		.insert(chatSession)
		.values({
			title: `DM: ${data.name}`,
			model: 'moonshotai/kimi-k2.5'
		})
		.returning();

	const [campaign] = await db
		.insert(dmCampaign)
		.values({
			name: data.name,
			description: data.description,
			chatSessionId: campaignChat.id
		})
		.returning();

	await getCampaigns().refresh();
	return campaign;
});

const updateCampaignSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	currentGameDay: z.number().optional()
});

export const updateCampaign = command(updateCampaignSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.currentGameDay !== undefined) updateData.currentGameDay = data.currentGameDay;

	const [updated] = await db
		.update(dmCampaign)
		.set(updateData)
		.where(eq(dmCampaign.id, data.id))
		.returning();

	await getCampaigns().refresh();
	await getCampaignById(data.id).refresh();
	return updated;
});

export const deleteCampaign = command(z.string(), async (id) => {
	// Also delete vectorized source chunks
	try {
		const sourcePrefix = `dm/${id}/`;
		vectorClient
			.prepare(
				`DELETE FROM memory_embeddings WHERE chunk_id IN (SELECT id FROM memory_chunks WHERE source LIKE ?)`
			)
			.run(`${sourcePrefix}%`);
		vectorClient.prepare(`DELETE FROM memory_chunks WHERE source LIKE ?`).run(`${sourcePrefix}%`);
	} catch (e) {
		console.error('Failed to clean up vector chunks for campaign:', e);
	}

	await db.delete(dmCampaign).where(eq(dmCampaign.id, id));
	await getCampaigns().refresh();
	return { success: true };
});

// ============== SOURCE BOOKS ==============

export const getCampaignSources = query(z.string(), async (campaignId) => {
	return await db.query.dmSource.findMany({
		where: eq(dmSource.campaignId, campaignId),
		orderBy: [desc(dmSource.createdAt)]
	});
});

const addSourceSchema = z.object({
	campaignId: z.string(),
	title: z.string().min(1),
	content: z.string().min(1),
	type: z.enum(['paste', 'file']).default('paste')
});

export const addSource = command(addSourceSchema, async (data) => {
	const [source] = await db
		.insert(dmSource)
		.values({
			campaignId: data.campaignId,
			title: data.title,
			content: data.content,
			type: data.type
		})
		.returning();

	// Vectorize the content: chunk into ~500 char overlapping segments
	try {
		const chunks = chunkText(data.content, 500, 100);
		const sourceTag = `dm/${data.campaignId}/source/${source.id}`;

		await storeChunks(
			chunks.map((text) => ({
				content: text,
				meta: {
					type: 'knowledge' as const,
					source: sourceTag
				}
			}))
		);

		await db.update(dmSource).set({ vectorized: true }).where(eq(dmSource.id, source.id));
	} catch (e) {
		console.error('Failed to vectorize source:', e);
	}

	await getCampaignSources(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return source;
});

export const deleteSource = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		// Clean up vector chunks
		const sourceTag = `dm/${campaignId}/source/${id}`;
		try {
			vectorClient
				.prepare(
					`DELETE FROM memory_embeddings WHERE chunk_id IN (SELECT id FROM memory_chunks WHERE source = ?)`
				)
				.run(sourceTag);
			vectorClient.prepare(`DELETE FROM memory_chunks WHERE source = ?`).run(sourceTag);
		} catch (e) {
			console.error('Failed to clean up vector chunks:', e);
		}

		await db.delete(dmSource).where(eq(dmSource.id, id));
		await getCampaignSources(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

export const hasSourceBooks = query(z.string(), async (campaignId) => {
	const sources = await db.query.dmSource.findMany({
		where: eq(dmSource.campaignId, campaignId),
		limit: 1
	});
	return sources.length > 0;
});

/** Search source books for a campaign (vector search filtered by source prefix) */
export const searchSourceBook = query(
	z.object({
		campaignId: z.string(),
		queryText: z.string(),
		limit: z.number().optional().default(5)
	}),
	async ({ campaignId, queryText, limit }) => {
		// Search broader, then filter by campaign source prefix
		const results = await searchMemoryInternal({ query: queryText, limit: limit * 3 });
		const prefix = `dm/${campaignId}/`;
		return results.filter((r) => r.source.startsWith(prefix)).slice(0, limit);
	}
);

// ============== SESSIONS ==============

export const getCampaignSessions = query(z.string(), async (campaignId) => {
	return await db.query.dmSession.findMany({
		where: eq(dmSession.campaignId, campaignId),
		orderBy: [desc(dmSession.sessionNumber)]
	});
});

export const getSessionById = query(z.string(), async (id) => {
	const session = await db.query.dmSession.findFirst({
		where: eq(dmSession.id, id)
	});
	if (!session) throw new Error('Session not found');
	return session;
});

const createSessionSchema = z.object({
	campaignId: z.string(),
	title: z.string().optional()
});

export const createSession = command(createSessionSchema, async (data) => {
	// Get the next session number
	const existing = await db.query.dmSession.findMany({
		where: eq(dmSession.campaignId, data.campaignId),
		orderBy: [desc(dmSession.sessionNumber)],
		limit: 1
	});
	const nextNumber = existing.length > 0 ? existing[0].sessionNumber + 1 : 1;

	const [session] = await db
		.insert(dmSession)
		.values({
			campaignId: data.campaignId,
			sessionNumber: nextNumber,
			title: data.title || `Session ${nextNumber}`,
			status: 'prep'
		})
		.returning();

	// Generate session prep asynchronously
	generateSessionPrep(session.id, data.campaignId).catch((e) =>
		console.error('Failed to generate session prep:', e)
	);

	await getCampaignSessions(data.campaignId).refresh();
	return session;
});

export const startSession = command(z.string(), async (sessionId) => {
	const session = await db.query.dmSession.findFirst({
		where: eq(dmSession.id, sessionId)
	});
	if (!session) throw new Error('Session not found');

	// Create a linked chat session
	const [chatSess] = await db
		.insert(chatSession)
		.values({
			title: `DM Session ${session.sessionNumber}: ${session.title}`,
			model: 'moonshotai/kimi-k2.5'
		})
		.returning();

	const [updated] = await db
		.update(dmSession)
		.set({
			status: 'active',
			chatSessionId: chatSess.id,
			startedAt: new Date()
		})
		.where(eq(dmSession.id, sessionId))
		.returning();

	await getSessionById(sessionId).refresh();
	await getCampaignSessions(session.campaignId).refresh();
	return updated;
});

export const endSession = command(z.string(), async (sessionId) => {
	const session = await db.query.dmSession.findFirst({
		where: eq(dmSession.id, sessionId)
	});
	if (!session) throw new Error('Session not found');

	// Generate recaps from the conversation
	let dmRecapText = '';
	let playerRecapText = '';
	let hooksJson = '[]';

	if (session.chatSessionId) {
		const messages = await db.query.message.findMany({
			where: eq(message.sessionId, session.chatSessionId),
			orderBy: (msg, { asc: a }) => [a(msg.createdAt)]
		});

		const chatMessages: ChatMessage[] = messages.map((m) => ({
			role: m.role as ChatMessage['role'],
			content: m.content
		}));

		if (chatMessages.length > 0) {
			// Get campaign context for better recaps
			const campaign = await db.query.dmCampaign.findFirst({
				where: eq(dmCampaign.id, session.campaignId)
			});

			const campaignContext = campaign ? `Campaign: ${campaign.name}\n${campaign.description}` : '';

			// Generate DM Recap
			try {
				const dmRecapResult = await chatSimple([
					{
						role: 'system',
						content: `You are a D&D 5e session scribe. Generate a DM-ONLY recap of this session. This is SECRET information not for players. Include:
- Secret plot timers advanced
- Faction reputation changes and reasons
- Consequence chains triggered (actions → results)
- NPC stance shifts and motivations
- Unresolved threads and things the players missed
- Behind-the-scenes developments
Format as clean markdown.

${campaignContext}`
					},
					...chatMessages,
					{
						role: 'user',
						content: 'Generate the DM-only session recap now.'
					}
				]);
				dmRecapText = (dmRecapResult.choices?.[0]?.message?.content as string) || '';
			} catch (e) {
				console.error('Failed to generate DM recap:', e);
				dmRecapText = '*Failed to generate recap*';
			}

			// Generate Player Recap
			try {
				const playerRecapResult = await chatSimple([
					{
						role: 'system',
						content: `You are a D&D 5e session scribe. Generate a PLAYER-SAFE recap of this session. This will be shared with players. Include:
- Key events and encounters
- Player achievements and heroic moments
- NPCs met and their apparent dispositions
- Items found (with legacy names like "The Arabelle Reward" not just "Rug of the Unicorn")
- Quests advanced or discovered
- Atmospheric moments and memorable scenes
- End with a dramatic cliffhanger or anticipation note
Format as engaging narrative markdown.

${campaignContext}`
					},
					...chatMessages,
					{
						role: 'user',
						content: 'Generate the player-safe session recap now.'
					}
				]);
				playerRecapText = (playerRecapResult.choices?.[0]?.message?.content as string) || '';
			} catch (e) {
				console.error('Failed to generate player recap:', e);
				playerRecapText = '*Failed to generate recap*';
			}

			// Generate Next Session Hooks
			try {
				const hooksResult = await chatSimple([
					{
						role: 'system',
						content: `You are a D&D 5e session planner. Based on this session's events, suggest exactly 3 concrete opening beats for the next session. Each should be a specific scene (e.g., "Kasimir intercepts you at the gate with urgent news about the amber temple"). Return as a JSON array of 3 strings. ONLY output the JSON array, nothing else.

${campaignContext}`
					},
					...chatMessages,
					{
						role: 'user',
						content: 'Suggest 3 opening beats for next session as a JSON array.'
					}
				]);
				const hooksContent = (hooksResult.choices?.[0]?.message?.content as string) || '[]';
				// Try to parse, fallback to empty
				try {
					const parsed = JSON.parse(
						hooksContent
							.replace(/```json?\n?/g, '')
							.replace(/```/g, '')
							.trim()
					);
					hooksJson = JSON.stringify(parsed);
				} catch {
					hooksJson = JSON.stringify([hooksContent]);
				}
			} catch (e) {
				console.error('Failed to generate hooks:', e);
			}

			// Store DM recap in vector memory for future RAG
			try {
				await storeChunks([
					{
						content: `Session ${session.sessionNumber} DM Recap:\n${dmRecapText}`,
						meta: {
							type: 'knowledge' as const,
							source: `dm/${session.campaignId}/recap/${session.id}`
						}
					}
				]);
			} catch (e) {
				console.error('Failed to store recap in vector memory:', e);
			}
		}
	}

	const [updated] = await db
		.update(dmSession)
		.set({
			status: 'completed',
			dmRecap: dmRecapText,
			playerRecap: playerRecapText,
			nextSessionHooks: hooksJson,
			completedAt: new Date()
		})
		.where(eq(dmSession.id, sessionId))
		.returning();

	await getSessionById(sessionId).refresh();
	await getCampaignSessions(session.campaignId).refresh();
	return updated;
});

export const updateSessionPrep = command(
	z.object({ id: z.string(), prepContent: z.string() }),
	async ({ id, prepContent }) => {
		const session = await db.query.dmSession.findFirst({
			where: eq(dmSession.id, id)
		});
		if (!session) throw new Error('Session not found');

		const [updated] = await db
			.update(dmSession)
			.set({ prepContent })
			.where(eq(dmSession.id, id))
			.returning();

		await getSessionById(id).refresh();
		return updated;
	}
);

// ============== FACTIONS ==============

export const getFactions = query(z.string(), async (campaignId) => {
	return await db.query.dmFaction.findMany({
		where: eq(dmFaction.campaignId, campaignId),
		orderBy: [asc(dmFaction.name)]
	});
});

const createFactionSchema = z.object({
	campaignId: z.string(),
	name: z.string().min(1),
	description: z.string().optional().default(''),
	reputation: z.number().min(-100).max(100).optional().default(0),
	thresholdNotes: z.string().optional().default('[]')
});

export const createFaction = command(createFactionSchema, async (data) => {
	const [faction] = await db.insert(dmFaction).values(data).returning();

	await getFactions(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return faction;
});

const updateFactionSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	reputation: z.number().min(-100).max(100).optional(),
	thresholdNotes: z.string().optional(),
	notes: z.string().optional()
});

export const updateFaction = command(updateFactionSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.reputation !== undefined) updateData.reputation = data.reputation;
	if (data.thresholdNotes !== undefined) updateData.thresholdNotes = data.thresholdNotes;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db
		.update(dmFaction)
		.set(updateData)
		.where(eq(dmFaction.id, data.id))
		.returning();

	await getFactions(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteFaction = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmFaction).where(eq(dmFaction.id, id));
		await getFactions(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

export const adjustReputation = command(
	z.object({
		factionId: z.string(),
		campaignId: z.string(),
		delta: z.number(),
		reason: z.string()
	}),
	async ({ factionId, campaignId, delta, reason }) => {
		const faction = await db.query.dmFaction.findFirst({
			where: eq(dmFaction.id, factionId)
		});
		if (!faction) throw new Error('Faction not found');

		const newRep = Math.max(-100, Math.min(100, faction.reputation + delta));
		const notes = faction.notes
			? `${faction.notes}\n[${new Date().toLocaleDateString()}] ${delta > 0 ? '+' : ''}${delta}: ${reason}`
			: `[${new Date().toLocaleDateString()}] ${delta > 0 ? '+' : ''}${delta}: ${reason}`;

		const [updated] = await db
			.update(dmFaction)
			.set({ reputation: newRep, notes, updatedAt: new Date() })
			.where(eq(dmFaction.id, factionId))
			.returning();

		await getFactions(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return updated;
	}
);

// ============== CONSEQUENCES (Butterfly Effect) ==============

export const getConsequences = query(z.string(), async (campaignId) => {
	return await db.query.dmConsequence.findMany({
		where: eq(dmConsequence.campaignId, campaignId),
		orderBy: [desc(dmConsequence.createdAt)]
	});
});

const logConsequenceSchema = z.object({
	campaignId: z.string(),
	sessionId: z.string().optional(),
	action: z.string().min(1),
	results: z.string().default('[]') // JSON array
});

export const logConsequence = command(logConsequenceSchema, async (data) => {
	const [consequence] = await db.insert(dmConsequence).values(data).returning();

	await getConsequences(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return consequence;
});

export const updateConsequence = command(
	z.object({ id: z.string(), campaignId: z.string(), results: z.string() }),
	async ({ id, campaignId, results }) => {
		const [updated] = await db
			.update(dmConsequence)
			.set({ results })
			.where(eq(dmConsequence.id, id))
			.returning();

		await getConsequences(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return updated;
	}
);

export const deleteConsequence = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmConsequence).where(eq(dmConsequence.id, id));
		await getConsequences(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== QUESTS ==============

export const getQuests = query(z.string(), async (campaignId) => {
	return await db.query.dmQuest.findMany({
		where: eq(dmQuest.campaignId, campaignId),
		orderBy: [asc(dmQuest.title)]
	});
});

const createQuestSchema = z.object({
	campaignId: z.string(),
	title: z.string().min(1),
	description: z.string().optional().default(''),
	category: z.enum(['active_lead', 'hard_deadline', 'rumor', 'side_quest']).default('active_lead'),
	deadline: z.string().optional(),
	urgency: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
	status: z.enum(['active', 'completed', 'failed', 'hidden']).default('active'),
	notes: z.string().optional()
});

export const createQuest = command(createQuestSchema, async (data) => {
	const [quest] = await db.insert(dmQuest).values(data).returning();

	await getQuests(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return quest;
});

const updateQuestSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	title: z.string().optional(),
	description: z.string().optional(),
	category: z.enum(['active_lead', 'hard_deadline', 'rumor', 'side_quest']).optional(),
	deadline: z.string().nullish(),
	urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
	status: z.enum(['active', 'completed', 'failed', 'hidden']).optional(),
	relatedNpcIds: z.string().optional(),
	relatedItemIds: z.string().optional(),
	notes: z.string().optional()
});

export const updateQuest = command(updateQuestSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.category !== undefined) updateData.category = data.category;
	if (data.deadline !== undefined) updateData.deadline = data.deadline;
	if (data.urgency !== undefined) updateData.urgency = data.urgency;
	if (data.status !== undefined) updateData.status = data.status;
	if (data.relatedNpcIds !== undefined) updateData.relatedNpcIds = data.relatedNpcIds;
	if (data.relatedItemIds !== undefined) updateData.relatedItemIds = data.relatedItemIds;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db
		.update(dmQuest)
		.set(updateData)
		.where(eq(dmQuest.id, data.id))
		.returning();

	await getQuests(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteQuest = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmQuest).where(eq(dmQuest.id, id));
		await getQuests(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== ITEMS ==============

export const getItems = query(z.string(), async (campaignId) => {
	return await db.query.dmItem.findMany({
		where: eq(dmItem.campaignId, campaignId),
		orderBy: [asc(dmItem.name)]
	});
});

const createItemSchema = z.object({
	campaignId: z.string(),
	name: z.string().min(1),
	description: z.string().optional().default(''),
	mechanicalProperties: z.string().optional().default(''),
	narrativeProperties: z.string().optional().default(''),
	origin: z.string().optional().default(''),
	currentHolder: z.string().optional(),
	isQuestGiver: z.boolean().optional().default(false),
	questHooks: z.string().optional().default('[]'),
	tags: z.string().optional().default('[]'),
	notes: z.string().optional()
});

export const createItem = command(createItemSchema, async (data) => {
	const [item] = await db.insert(dmItem).values(data).returning();
	await getItems(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return item;
});

const updateItemSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	mechanicalProperties: z.string().optional(),
	narrativeProperties: z.string().optional(),
	origin: z.string().optional(),
	currentHolder: z.string().nullish(),
	isQuestGiver: z.boolean().optional(),
	questHooks: z.string().optional(),
	tags: z.string().optional(),
	notes: z.string().optional()
});

export const updateItem = command(updateItemSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.mechanicalProperties !== undefined)
		updateData.mechanicalProperties = data.mechanicalProperties;
	if (data.narrativeProperties !== undefined)
		updateData.narrativeProperties = data.narrativeProperties;
	if (data.origin !== undefined) updateData.origin = data.origin;
	if (data.currentHolder !== undefined) updateData.currentHolder = data.currentHolder;
	if (data.isQuestGiver !== undefined) updateData.isQuestGiver = data.isQuestGiver;
	if (data.questHooks !== undefined) updateData.questHooks = data.questHooks;
	if (data.tags !== undefined) updateData.tags = data.tags;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db
		.update(dmItem)
		.set(updateData)
		.where(eq(dmItem.id, data.id))
		.returning();
	await getItems(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteItem = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmItem).where(eq(dmItem.id, id));
		await getItems(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== NPCs ==============

export const getNpcs = query(z.string(), async (campaignId) => {
	return await db.query.dmNpc.findMany({
		where: eq(dmNpc.campaignId, campaignId),
		orderBy: [asc(dmNpc.name)]
	});
});

const createNpcSchema = z.object({
	campaignId: z.string(),
	name: z.string().min(1),
	race: z.string().optional(),
	description: z.string().optional().default(''),
	location: z.string().optional(),
	voice: z.string().optional().default(''),
	temperament: z.string().optional().default(''),
	stance: z.string().optional().default('Neutral'),
	statusTags: z.string().optional().default('[]'),
	secrets: z.string().optional().default(''),
	rumorPool: z.string().optional().default('[]'),
	factionId: z.string().optional(),
	alive: z.boolean().optional().default(true),
	notes: z.string().optional()
});

export const createNpc = command(createNpcSchema, async (data) => {
	const [npc] = await db.insert(dmNpc).values(data).returning();
	await getNpcs(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return npc;
});

const updateNpcSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	name: z.string().optional(),
	race: z.string().optional(),
	description: z.string().optional(),
	location: z.string().optional(),
	voice: z.string().optional(),
	temperament: z.string().optional(),
	stance: z.string().optional(),
	statusTags: z.string().optional(),
	secrets: z.string().optional(),
	rumorPool: z.string().optional(),
	factionId: z.string().nullish(),
	alive: z.boolean().optional(),
	notes: z.string().optional()
});

export const updateNpc = command(updateNpcSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.race !== undefined) updateData.race = data.race;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.location !== undefined) updateData.location = data.location;
	if (data.voice !== undefined) updateData.voice = data.voice;
	if (data.temperament !== undefined) updateData.temperament = data.temperament;
	if (data.stance !== undefined) updateData.stance = data.stance;
	if (data.statusTags !== undefined) updateData.statusTags = data.statusTags;
	if (data.secrets !== undefined) updateData.secrets = data.secrets;
	if (data.rumorPool !== undefined) updateData.rumorPool = data.rumorPool;
	if (data.factionId !== undefined) updateData.factionId = data.factionId;
	if (data.alive !== undefined) updateData.alive = data.alive;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db.update(dmNpc).set(updateData).where(eq(dmNpc.id, data.id)).returning();
	await getNpcs(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteNpc = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmNpc).where(eq(dmNpc.id, id));
		await getNpcs(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== PARTY MEMBERS ==============

export const getPartyMembers = query(z.string(), async (campaignId) => {
	return await db.query.dmPartyMember.findMany({
		where: eq(dmPartyMember.campaignId, campaignId),
		orderBy: [asc(dmPartyMember.characterName)]
	});
});

const createPartyMemberSchema = z.object({
	campaignId: z.string(),
	playerName: z.string().min(1),
	characterName: z.string().min(1),
	race: z.string().optional(),
	class: z.string().optional(),
	level: z.number().optional().default(1),
	backstoryHooks: z.string().optional().default(''),
	notableItems: z.string().optional().default('[]'),
	relationships: z.string().optional().default(''),
	notes: z.string().optional()
});

export const createPartyMember = command(createPartyMemberSchema, async (data) => {
	const [member] = await db.insert(dmPartyMember).values(data).returning();
	await getPartyMembers(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return member;
});

const updatePartyMemberSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	playerName: z.string().optional(),
	characterName: z.string().optional(),
	race: z.string().optional(),
	class: z.string().optional(),
	level: z.number().optional(),
	backstoryHooks: z.string().optional(),
	notableItems: z.string().optional(),
	relationships: z.string().optional(),
	notes: z.string().optional()
});

export const updatePartyMember = command(updatePartyMemberSchema, async (data) => {
	const updateData: Record<string, unknown> = {};
	if (data.playerName !== undefined) updateData.playerName = data.playerName;
	if (data.characterName !== undefined) updateData.characterName = data.characterName;
	if (data.race !== undefined) updateData.race = data.race;
	if (data.class !== undefined) updateData.class = data.class;
	if (data.level !== undefined) updateData.level = data.level;
	if (data.backstoryHooks !== undefined) updateData.backstoryHooks = data.backstoryHooks;
	if (data.notableItems !== undefined) updateData.notableItems = data.notableItems;
	if (data.relationships !== undefined) updateData.relationships = data.relationships;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db
		.update(dmPartyMember)
		.set(updateData)
		.where(eq(dmPartyMember.id, data.id))
		.returning();

	await getPartyMembers(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deletePartyMember = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmPartyMember).where(eq(dmPartyMember.id, id));
		await getPartyMembers(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== LOCATIONS ==============

export const getLocations = query(z.string(), async (campaignId) => {
	return await db.query.dmLocation.findMany({
		where: eq(dmLocation.campaignId, campaignId),
		orderBy: [asc(dmLocation.name)]
	});
});

const createLocationSchema = z.object({
	campaignId: z.string(),
	name: z.string().min(1),
	locationType: z
		.enum(['city', 'town', 'village', 'dungeon', 'wilderness', 'building', 'region', 'other'])
		.optional()
		.default('other'),
	description: z.string().optional().default(''),
	parentLocationId: z.string().optional(),
	linkedNpcIds: z.string().optional().default('[]'),
	linkedQuestIds: z.string().optional().default('[]'),
	tags: z.string().optional().default('[]'),
	notes: z.string().optional()
});

export const createLocation = command(createLocationSchema, async (data) => {
	const [location] = await db.insert(dmLocation).values(data).returning();
	await getLocations(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return location;
});

const updateLocationSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	name: z.string().optional(),
	locationType: z
		.enum(['city', 'town', 'village', 'dungeon', 'wilderness', 'building', 'region', 'other'])
		.optional(),
	description: z.string().optional(),
	parentLocationId: z.string().nullable().optional(),
	linkedNpcIds: z.string().optional(),
	linkedQuestIds: z.string().optional(),
	tags: z.string().optional(),
	notes: z.string().optional()
});

export const updateLocation = command(updateLocationSchema, async (data) => {
	const updateData: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) updateData.name = data.name;
	if (data.locationType !== undefined) updateData.locationType = data.locationType;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.parentLocationId !== undefined) updateData.parentLocationId = data.parentLocationId;
	if (data.linkedNpcIds !== undefined) updateData.linkedNpcIds = data.linkedNpcIds;
	if (data.linkedQuestIds !== undefined) updateData.linkedQuestIds = data.linkedQuestIds;
	if (data.tags !== undefined) updateData.tags = data.tags;
	if (data.notes !== undefined) updateData.notes = data.notes;

	const [updated] = await db
		.update(dmLocation)
		.set(updateData)
		.where(eq(dmLocation.id, data.id))
		.returning();

	await getLocations(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteLocation = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmLocation).where(eq(dmLocation.id, id));
		await getLocations(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== CALENDAR EVENTS ==============

export const getCalendarEvents = query(z.string(), async (campaignId) => {
	return await db.query.dmCalendarEvent.findMany({
		where: eq(dmCalendarEvent.campaignId, campaignId),
		orderBy: [asc(dmCalendarEvent.gameDay)]
	});
});

const createCalendarEventSchema = z.object({
	campaignId: z.string(),
	title: z.string().min(1),
	description: z.string().optional().default(''),
	gameDay: z.number().int().min(1),
	category: z
		.enum(['quest_deadline', 'festival', 'political', 'travel', 'combat', 'note'])
		.optional()
		.default('note')
});

export const createCalendarEvent = command(createCalendarEventSchema, async (data) => {
	const [event] = await db.insert(dmCalendarEvent).values(data).returning();
	await getCalendarEvents(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return event;
});

const updateCalendarEventSchema = z.object({
	id: z.string(),
	campaignId: z.string(),
	title: z.string().optional(),
	description: z.string().optional(),
	gameDay: z.number().int().min(1).optional(),
	category: z
		.enum(['quest_deadline', 'festival', 'political', 'travel', 'combat', 'note'])
		.optional()
});

export const updateCalendarEvent = command(updateCalendarEventSchema, async (data) => {
	const updateData: Record<string, unknown> = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.gameDay !== undefined) updateData.gameDay = data.gameDay;
	if (data.category !== undefined) updateData.category = data.category;

	const [updated] = await db
		.update(dmCalendarEvent)
		.set(updateData)
		.where(eq(dmCalendarEvent.id, data.id))
		.returning();

	await getCalendarEvents(data.campaignId).refresh();
	await getCampaignById(data.campaignId).refresh();
	return updated;
});

export const deleteCalendarEvent = command(
	z.object({ id: z.string(), campaignId: z.string() }),
	async ({ id, campaignId }) => {
		await db.delete(dmCalendarEvent).where(eq(dmCalendarEvent.id, id));
		await getCalendarEvents(campaignId).refresh();
		await getCampaignById(campaignId).refresh();
		return { success: true };
	}
);

// ============== SESSION NOTES ==============

export const updateSessionNotes = command(
	z.object({ sessionId: z.string(), campaignId: z.string(), notes: z.string() }),
	async ({ sessionId, campaignId, notes }) => {
		const [updated] = await db
			.update(dmSession)
			.set({ notes })
			.where(eq(dmSession.id, sessionId))
			.returning();

		await getCampaignById(campaignId).refresh();
		return updated;
	}
);

// ============== CAMPAIGN EXPORT / IMPORT ==============

export const exportCampaign = query(z.string(), async (campaignId) => {
	const campaign = await db.query.dmCampaign.findFirst({
		where: eq(dmCampaign.id, campaignId),
		with: {
			sources: true,
			sessions: true,
			factions: true,
			consequences: true,
			quests: true,
			items: true,
			npcs: true,
			partyMembers: true,
			locations: true,
			calendarEvents: true
		}
	});
	if (!campaign) throw new Error('Campaign not found');
	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		campaign
	};
});

export const importCampaign = command(z.string(), async (jsonStr) => {
	const data = JSON.parse(jsonStr);
	const src = data.campaign;
	if (!src?.name) throw new Error('Invalid campaign data');

	// Create campaign chat session
	const [campaignChat] = await db
		.insert(chatSession)
		.values({ title: `DM: ${src.name}`, model: 'moonshotai/kimi-k2.5' })
		.returning();

	const [campaign] = await db
		.insert(dmCampaign)
		.values({
			name: src.name,
			description: src.description || '',
			chatSessionId: campaignChat.id,
			currentGameDay: src.currentGameDay || 1
		})
		.returning();

	const cid = campaign.id;

	// Import each entity type
	if (src.factions?.length) {
		for (const f of src.factions) {
			await db.insert(dmFaction).values({
				campaignId: cid,
				name: f.name,
				description: f.description || '',
				reputation: f.reputation || 0,
				thresholdNotes: f.thresholdNotes || '[]',
				notes: f.notes
			});
		}
	}
	if (src.npcs?.length) {
		for (const n of src.npcs) {
			await db.insert(dmNpc).values({
				campaignId: cid,
				name: n.name,
				race: n.race,
				description: n.description || '',
				location: n.location,
				voice: n.voice || '',
				temperament: n.temperament || '',
				stance: n.stance || 'Neutral',
				statusTags: n.statusTags || '[]',
				secrets: n.secrets || '',
				rumorPool: n.rumorPool || '[]',
				factionId: n.factionId,
				alive: n.alive ?? true,
				notes: n.notes
			});
		}
	}
	if (src.quests?.length) {
		for (const q of src.quests) {
			await db.insert(dmQuest).values({
				campaignId: cid,
				title: q.title,
				description: q.description || '',
				category: q.category || 'active_lead',
				deadline: q.deadline,
				urgency: q.urgency || 'medium',
				status: q.status || 'active',
				relatedNpcIds: q.relatedNpcIds || '[]',
				relatedItemIds: q.relatedItemIds || '[]',
				notes: q.notes
			});
		}
	}
	if (src.items?.length) {
		for (const i of src.items) {
			await db.insert(dmItem).values({
				campaignId: cid,
				name: i.name,
				description: i.description || '',
				mechanicalProperties: i.mechanicalProperties || '',
				narrativeProperties: i.narrativeProperties || '',
				origin: i.origin || '',
				currentHolder: i.currentHolder,
				isQuestGiver: i.isQuestGiver ?? false,
				questHooks: i.questHooks || '[]',
				tags: i.tags || '[]',
				notes: i.notes
			});
		}
	}
	if (src.partyMembers?.length) {
		for (const p of src.partyMembers) {
			await db.insert(dmPartyMember).values({
				campaignId: cid,
				playerName: p.playerName,
				characterName: p.characterName,
				race: p.race,
				class: p.class,
				level: p.level || 1,
				backstoryHooks: p.backstoryHooks || '',
				notableItems: p.notableItems || '[]',
				relationships: p.relationships || '',
				notes: p.notes
			});
		}
	}
	if (src.locations?.length) {
		for (const l of src.locations) {
			await db.insert(dmLocation).values({
				campaignId: cid,
				name: l.name,
				locationType: l.locationType || 'other',
				description: l.description || '',
				parentLocationId: l.parentLocationId,
				linkedNpcIds: l.linkedNpcIds || '[]',
				linkedQuestIds: l.linkedQuestIds || '[]',
				tags: l.tags || '[]',
				notes: l.notes
			});
		}
	}
	if (src.calendarEvents?.length) {
		for (const e of src.calendarEvents) {
			await db.insert(dmCalendarEvent).values({
				campaignId: cid,
				title: e.title,
				description: e.description || '',
				gameDay: e.gameDay,
				category: e.category || 'note'
			});
		}
	}
	if (src.consequences?.length) {
		for (const c of src.consequences) {
			await db.insert(dmConsequence).values({
				campaignId: cid,
				sessionId: c.sessionId,
				action: c.action,
				results: c.results || '[]'
			});
		}
	}
	// Sources are imported but NOT vectorized (user can re-vectorize)
	if (src.sources?.length) {
		for (const s of src.sources) {
			await db.insert(dmSource).values({
				campaignId: cid,
				title: s.title,
				content: s.content,
				type: s.type || 'paste',
				vectorized: false
			});
		}
	}

	await getCampaigns().refresh();
	return campaign;
});

// ============== RULE QUICK-LOOKUP ==============

export const ruleLookup = command(
	z.object({ campaignId: z.string(), question: z.string().min(1) }),
	async ({ campaignId, question }) => {
		// Search vectorized source books
		const sourcePrefix = `dm/${campaignId}/`;
		let relevantContext = '';
		try {
			const results = await searchMemoryInternal(question, 5, sourcePrefix);
			if (results.length > 0) {
				relevantContext = results.map((r: { content: string }) => r.content).join('\n---\n');
			}
		} catch (e) {
			console.error('Vector search failed:', e);
		}

		if (!relevantContext) {
			return {
				answer: 'No source books found. Upload and vectorize source material first.',
				sources: []
			};
		}

		const messages: ChatMessage[] = [
			{
				role: 'system',
				content: `You are a D&D 5e rules expert. Answer the question using ONLY the provided source book context. Be concise and cite the source where possible. If the answer isn't in the sources, say so.\n\nSource Material:\n${relevantContext}`
			},
			{ role: 'user', content: question }
		];

		const result = await chatSimple(messages);
		const answer =
			(result.choices?.[0]?.message?.content as string) || 'Unable to generate answer.';
		return { answer, sources: relevantContext.split('\n---\n').slice(0, 3) };
	}
);

// ============== CAMPAIGN CONTEXT BUILDER ==============
// getCampaignContext is in dm-helpers.server.ts (cannot be exported from .remote.ts)
import { getCampaignContext } from '$lib/dm/dm-helpers.server';

// ============== HELPERS ==============

/** Chunk text into overlapping segments for vectorization */
function chunkText(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
	if (text.length <= chunkSize) return [text];

	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		const end = Math.min(start + chunkSize, text.length);
		chunks.push(text.slice(start, end));
		start += chunkSize - overlap;
		if (end === text.length) break;
	}
	return chunks;
}

/** Generate session prep content using AI */
async function generateSessionPrep(sessionId: string, campaignId: string): Promise<void> {
	const context = await getCampaignContext(campaignId);
	const session = await db.query.dmSession.findFirst({
		where: eq(dmSession.id, sessionId)
	});
	if (!session) return;

	// Check for hooks from previous session
	const prevSessions = await db.query.dmSession.findMany({
		where: eq(dmSession.campaignId, campaignId),
		orderBy: [desc(dmSession.sessionNumber)],
		limit: 2
	});
	const prevSession = prevSessions.find((s) => s.id !== sessionId);
	let hooksContext = '';
	if (prevSession?.nextSessionHooks) {
		try {
			const hooks = JSON.parse(prevSession.nextSessionHooks) as string[];
			hooksContext = `\n\nSuggested opening beats from the last session's wrap-up:\n${hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}`;
		} catch {
			/* skip */
		}
	}

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: `You are an expert D&D 5e Dungeon Master assistant preparing for the next session. Use all the campaign context below to create a thorough prep document.

${context}`
		},
		{
			role: 'user',
			content: `Generate a session prep document for Session ${session.sessionNumber} (${session.title}).${hooksContext}

Include:
1. **Opening Scene** — A concrete opening beat (use suggested hooks if available)
2. **Key Plot Threads** — What storylines to advance this session
3. **NPC Interactions** — Which NPCs might appear, with voice/stance notes
4. **Consequence Ripples** — How past player choices manifest this session
5. **Potential Encounters** — Suggested encounters with CR-appropriate difficulty
6. **Decision Points** — Major choices the players might face, with branching outcomes
7. **Faction Dynamics** — How faction relationships affect this session
8. **Items of Interest** — Any quest-giver items that might "activate" or new loot appropriate to current hooks
9. **Pacing Notes** — Session tempo suggestions

Format as clean, scannable markdown.`
		}
	];

	try {
		const result = await chatSimple(messages);
		const content = result.choices?.[0]?.message?.content as string;
		if (content) {
			await db.update(dmSession).set({ prepContent: content }).where(eq(dmSession.id, sessionId));
			await getSessionById(sessionId).refresh();
		}
	} catch (e) {
		console.error('Failed to generate session prep:', e);
	}
}
