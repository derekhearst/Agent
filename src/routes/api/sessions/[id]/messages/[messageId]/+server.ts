import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { message, chatSession } from '$lib/server/db/schema';
import { eq, and, gte } from 'drizzle-orm';

// DELETE a message and all messages after it (for edit/regenerate)
export const DELETE: RequestHandler = async ({ params }) => {
	const { id: sessionId, messageId } = params;

	// Find the target message to get its timestamp
	const target = await db.query.message.findFirst({
		where: and(eq(message.id, messageId), eq(message.sessionId, sessionId))
	});

	if (!target) {
		return json({ error: 'Message not found' }, { status: 404 });
	}

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

	return json({ deleted: deleted.length, remainingCount: remaining.length });
};
