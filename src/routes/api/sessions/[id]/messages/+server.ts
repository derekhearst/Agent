import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { message } from '$lib/server/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const messages = await db.query.message.findMany({
		where: eq(message.sessionId, params.id),
		orderBy: [asc(message.createdAt)]
	});

	return json(messages);
};
