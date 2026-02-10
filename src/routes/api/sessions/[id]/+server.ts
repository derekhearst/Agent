import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { chatSession } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const session = await db.query.chatSession.findFirst({
		where: eq(chatSession.id, params.id)
	});

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json(session);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (body.title !== undefined) updates.title = body.title;
	if (body.model !== undefined) updates.model = body.model;

	const result = await db
		.update(chatSession)
		.set(updates)
		.where(eq(chatSession.id, params.id))
		.returning();

	if (!result.length) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json(result[0]);
};

export const DELETE: RequestHandler = async ({ params }) => {
	// Messages are cascade-deleted via FK constraint
	const result = await db.delete(chatSession).where(eq(chatSession.id, params.id)).returning();

	if (!result.length) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json({ success: true });
};
