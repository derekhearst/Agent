// Vector store service — stores and retrieves memory chunks with embeddings
import { client } from '$lib/server/db';
import { generateEmbedding, generateEmbeddings } from '$lib/server/embeddings';

export type MemoryType = 'conversation' | 'knowledge' | 'note';

export interface MemoryChunk {
	id: number;
	sessionId: string | null;
	content: string;
	type: MemoryType;
	source: string;
	createdAt: number;
}

export interface SearchResult extends MemoryChunk {
	distance: number;
}

export interface VectorStats {
	total: number;
	byType: Record<string, number>;
}

// Prepared statements for performance
const insertChunkStmt = client.prepare(`
	INSERT INTO memory_chunks (session_id, content, type, source, created_at)
	VALUES (?, ?, ?, ?, unixepoch())
`);

const insertEmbeddingStmt = client.prepare(`
	INSERT INTO memory_embeddings (chunk_id, embedding)
	VALUES (CAST(? AS INTEGER), ?)
`);

const searchStmt = client.prepare(`
	SELECT
		me.chunk_id,
		me.distance,
		mc.id,
		mc.session_id,
		mc.content,
		mc.type,
		mc.source,
		mc.created_at
	FROM memory_embeddings me
	INNER JOIN memory_chunks mc ON mc.id = me.chunk_id
	WHERE me.embedding MATCH ?
		AND me.k = ?
	ORDER BY me.distance ASC
`);

const statsStmt = client.prepare(`
	SELECT type, COUNT(*) as count FROM memory_chunks GROUP BY type
`);

const totalStmt = client.prepare(`
	SELECT COUNT(*) as total FROM memory_chunks
`);

const deleteChunkStmt = client.prepare(`DELETE FROM memory_chunks WHERE id = ?`);
const deleteEmbeddingStmt = client.prepare(`DELETE FROM memory_embeddings WHERE chunk_id = ?`);

/**
 * Store a single text chunk with its embedding in the vector store.
 */
export async function storeChunk(
	content: string,
	meta: { sessionId?: string; type: MemoryType; source: string }
): Promise<number> {
	const embedding = await generateEmbedding(content);

	const result = insertChunkStmt.run(meta.sessionId || null, content, meta.type, meta.source);

	const chunkId = Number(result.lastInsertRowid);

	// Convert to Float32Array for sqlite-vec
	const float32 = new Float32Array(embedding);
	insertEmbeddingStmt.run(chunkId, Buffer.from(float32.buffer));

	return chunkId;
}

/**
 * Store multiple text chunks with their embeddings (batch).
 */
export async function storeChunks(
	chunks: Array<{
		content: string;
		meta: { sessionId?: string; type: MemoryType; source: string };
	}>
): Promise<number[]> {
	if (chunks.length === 0) return [];

	const texts = chunks.map((c) => c.content);
	const embeddings = await generateEmbeddings(texts);

	const ids: number[] = [];

	const insertMany = client.transaction(() => {
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			const embedding = embeddings[i];

			const result = insertChunkStmt.run(
				chunk.meta.sessionId || null,
				chunk.content,
				chunk.meta.type,
				chunk.meta.source
			);

			const chunkId = Number(result.lastInsertRowid);
			ids.push(chunkId);

			const float32 = new Float32Array(embedding);
			insertEmbeddingStmt.run(chunkId, Buffer.from(float32.buffer));
		}
	});

	insertMany();
	return ids;
}

/**
 * Search the vector store for chunks semantically similar to the query.
 */
export async function searchMemory(query: string, limit: number = 5): Promise<SearchResult[]> {
	const embedding = await generateEmbedding(query);
	const float32 = new Float32Array(embedding);

	const rows = searchStmt.all(Buffer.from(float32.buffer), limit) as Array<{
		chunk_id: number;
		distance: number;
		id: number;
		session_id: string | null;
		content: string;
		type: string;
		source: string;
		created_at: number;
	}>;

	return rows.map((row) => ({
		id: row.id,
		sessionId: row.session_id,
		content: row.content,
		type: row.type as MemoryType,
		source: row.source,
		createdAt: row.created_at,
		distance: row.distance
	}));
}

/**
 * Delete a memory chunk and its embedding.
 */
export function deleteChunk(id: number): void {
	deleteEmbeddingStmt.run(id);
	deleteChunkStmt.run(id);
}

/**
 * Get vector store statistics.
 */
export function getStats(): VectorStats {
	const total = (totalStmt.get() as { total: number }).total;
	const byTypeRows = statsStmt.all() as Array<{ type: string; count: number }>;
	const byType: Record<string, number> = {};
	for (const row of byTypeRows) {
		byType[row.type] = row.count;
	}
	return { total, byType };
}

/**
 * Chunk a conversation into overlapping segments for embedding.
 * Each chunk includes ~3-4 message pairs with context.
 */
export function chunkConversation(
	messages: Array<{ role: string; content: string }>,
	chunkSize: number = 4
): string[] {
	if (messages.length === 0) return [];

	const chunks: string[] = [];
	const step = Math.max(1, Math.floor(chunkSize / 2)); // 50% overlap

	for (let i = 0; i < messages.length; i += step) {
		const slice = messages.slice(i, i + chunkSize);
		const text = slice.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

		if (text.trim()) {
			chunks.push(text);
		}

		// Don't create tiny trailing chunks
		if (i + chunkSize >= messages.length) break;
	}

	return chunks;
}
