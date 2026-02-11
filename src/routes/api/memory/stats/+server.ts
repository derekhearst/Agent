// GET /api/memory/stats — vector store statistics
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStats } from '$lib/server/vector-store';

export const GET: RequestHandler = async () => {
	try {
		const stats = getStats();
		return json(stats);
	} catch (error) {
		console.error('Memory stats error:', error);
		return json({ total: 0, byType: {} });
	}
};
