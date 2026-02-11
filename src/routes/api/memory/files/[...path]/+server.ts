// GET /api/memory/files/[...path] — read a specific memory file
// PUT /api/memory/files/[...path] — update a memory file
// DELETE /api/memory/files/[...path] — delete a memory file or directory
import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readMemoryFile, writeMemoryFile, deleteMemoryFile } from '$lib/server/memory-files';

export const GET: RequestHandler = async ({ params }) => {
	const filePath = params.path;
	if (!filePath) {
		return json({ error: 'path is required' }, { status: 400 });
	}

	try {
		const content = await readMemoryFile(filePath);
		return text(content);
	} catch {
		return json({ error: 'File not found' }, { status: 404 });
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const filePath = params.path;
	if (!filePath) {
		return json({ error: 'path is required' }, { status: 400 });
	}

	const body = await request.json();
	await writeMemoryFile(filePath, body.content || '');
	return json({ success: true, path: filePath });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const filePath = params.path;
	if (!filePath) {
		return json({ error: 'path is required' }, { status: 400 });
	}

	try {
		await deleteMemoryFile(filePath);
		return json({ success: true });
	} catch {
		return json({ error: 'File not found' }, { status: 404 });
	}
};
