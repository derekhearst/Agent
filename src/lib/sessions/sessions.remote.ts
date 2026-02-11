// Sessions module — chat session CRUD and message management
import { z } from 'zod';
import { query, command } from '$app/server';
import { db, chatSession, message } from '$lib/shared/db';
import { desc, eq, asc, and, gte } from 'drizzle-orm';

// -- Queries --

export const getSessions = query(async () => {
	return await db.query.chatSession.findMany({
		orderBy: [desc(chatSession.updatedAt)]
	});
});

export const getSessionById = query(z.string(), async (id) => {
	const session = await db.query.chatSession.findFirst({
		where: eq(chatSession.id, id)
	});
	if (!session) throw new Error('Session not found');
	return session;
});

export const getSessionMessages = query(z.string(), async (sessionId) => {
	return await db.query.message.findMany({
		where: eq(message.sessionId, sessionId),
		orderBy: [asc(message.createdAt)]
	});
});

// -- Commands --

const createSessionSchema = z.object({
	title: z.string().optional().default('New Chat'),
	model: z.string().optional().default('moonshotai/kimi-k2.5')
});

export const createSession = command(createSessionSchema, async (data) => {
	const [session] = await db
		.insert(chatSession)
		.values({ title: data.title, model: data.model })
		.returning();

	await getSessions().refresh();
	return session;
});

const updateSessionSchema = z.object({
	id: z.string(),
	title: z.string().optional(),
	model: z.string().optional()
});

export const updateSession = command(updateSessionSchema, async (data) => {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (data.title !== undefined) updates.title = data.title;
	if (data.model !== undefined) updates.model = data.model;

	const [updated] = await db
		.update(chatSession)
		.set(updates)
		.where(eq(chatSession.id, data.id))
		.returning();

	if (!updated) throw new Error('Session not found');

	await getSessions().refresh();
	await getSessionById(data.id).refresh();
	return updated;
});

export const deleteSession = command(z.string(), async (id) => {
	const result = await db.delete(chatSession).where(eq(chatSession.id, id)).returning();
	if (!result.length) throw new Error('Session not found');

	await getSessions().refresh();
	return { success: true };
});

const deleteMessageSchema = z.object({
	sessionId: z.string(),
	messageId: z.string()
});

export const deleteMessageAndAfter = command(
	deleteMessageSchema,
	async ({ sessionId, messageId }) => {
		// Find the target message to get its timestamp
		const target = await db.query.message.findFirst({
			where: and(eq(message.id, messageId), eq(message.sessionId, sessionId))
		});

		if (!target) throw new Error('Message not found');

		// Delete this message and all messages created at or after its timestamp
		const deleted = await db
			.delete(message)
			.where(and(eq(message.sessionId, sessionId), gte(message.createdAt, target.createdAt)))
			.returning();

		// Update message count on the session
		const remaining = await db.query.message.findMany({
			where: eq(message.sessionId, sessionId)
		});

		await db
			.update(chatSession)
			.set({ messageCount: remaining.length, updatedAt: new Date() })
			.where(eq(chatSession.id, sessionId));

		await getSessionMessages(sessionId).refresh();
		await getSessions().refresh();

		return { deleted: deleted.length, remainingCount: remaining.length };
	}
);
