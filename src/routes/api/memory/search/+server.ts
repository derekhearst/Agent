// POST /api/memory/search — semantic search through vector store
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchMemory } from '$lib/server/vector-store';

export const POST: RequestHandler = async ({ request }) => {
	const { query, limit = 10 } = await request.json();

	if (!query) {
		return json({ error: 'query is required' }, { status: 400 });
	}

	try {
		const results = await searchMemory(query, limit);
		return json(results);
	} catch (error) {
		console.error('Memory search error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Search failed' },
			{ status: 500 }
		);
	}
};
