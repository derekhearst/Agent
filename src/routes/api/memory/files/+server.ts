// GET /api/memory/files — list all memory files as a tree
// POST /api/memory/files — create a new file
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMemoryFiles, writeMemoryFile, ensureMemoryDir } from '$lib/server/memory-files';

export const GET: RequestHandler = async () => {
	await ensureMemoryDir();
	const tree = await listMemoryFiles();
	return json(tree);
};

export const POST: RequestHandler = async ({ request }) => {
	const { path, content } = await request.json();

	if (!path) {
		return json({ error: 'path is required' }, { status: 400 });
	}

	await writeMemoryFile(path, content || '');
	return json({ success: true, path });
};
