import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { chatSession } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const sessions = await db.query.chatSession.findMany({
		orderBy: [desc(chatSession.updatedAt)]
	});
	return json(sessions);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const title = body?.title || 'New Chat';
	const model = body?.model || 'openrouter/auto';

	const result = await db.insert(chatSession).values({ title, model }).returning();

	return json(result[0], { status: 201 });
};
