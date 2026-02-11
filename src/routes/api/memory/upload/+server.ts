// POST /api/memory/upload — chunk and embed text into the vector store
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { storeChunks, type MemoryType } from '$lib/server/vector-store';

export const POST: RequestHandler = async ({ request }) => {
	const { content, source = 'Manual upload', type = 'knowledge' } = await request.json();

	if (!content) {
		return json({ error: 'content is required' }, { status: 400 });
	}

	try {
		// Chunk the text into ~500-token segments with overlap
		const chunks = chunkText(content, 1500, 200); // ~500 tokens ≈ 1500 chars

		const chunkData = chunks.map((text) => ({
			content: text,
			meta: {
				type: type as MemoryType,
				source
			}
		}));

		const ids = await storeChunks(chunkData);

		return json({
			success: true,
			chunksStored: ids.length,
			message: `Stored ${ids.length} chunks from "${source}"`
		});
	} catch (error) {
		console.error('Memory upload error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Upload failed' },
			{ status: 500 }
		);
	}
};

/**
 * Split text into overlapping chunks by character count.
 * Tries to break at paragraph/sentence boundaries.
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
	if (text.length <= chunkSize) return [text];

	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let end = start + chunkSize;

		if (end >= text.length) {
			chunks.push(text.slice(start).trim());
			break;
		}

		// Try to break at paragraph boundary
		const paragraphBreak = text.lastIndexOf('\n\n', end);
		if (paragraphBreak > start + chunkSize / 2) {
			end = paragraphBreak;
		} else {
			// Try sentence boundary
			const sentenceBreak = text.lastIndexOf('. ', end);
			if (sentenceBreak > start + chunkSize / 2) {
				end = sentenceBreak + 1;
			}
		}

		chunks.push(text.slice(start, end).trim());
		start = end - overlap;
	}

	return chunks.filter((c) => c.length > 0);
}
