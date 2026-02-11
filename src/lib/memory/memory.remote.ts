// Memory module — file storage, vector embeddings, and memory extraction
import { z } from 'zod';
import { query, command } from '$app/server';
import { db, vectorClient, message } from '$lib/shared/db';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { mkdir, readdir, readFile, writeFile, unlink, rm, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { existsSync } from 'node:fs';

// ============== TYPES ==============

export interface FileNode {
	name: string;
	path: string; // relative to MEMORY_DIR
	type: 'file' | 'directory';
	children?: FileNode[];
}

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

// ============== PRIVATE: FILE SYSTEM ==============

function getMemoryDir(): string {
	if (dev) {
		return join(process.cwd(), '.storage', 'memory');
	}
	return '/app/memory';
}

const MEMORY_DIR = getMemoryDir();

/** Ensure the memory directory and a default profile.md exist */
async function ensureMemoryDir(): Promise<void> {
	if (!existsSync(MEMORY_DIR)) {
		await mkdir(MEMORY_DIR, { recursive: true });
	}

	const profilePath = join(MEMORY_DIR, 'profile.md');
	if (!existsSync(profilePath)) {
		await writeFile(
			profilePath,
			`# User Profile

<!-- Add your preferences, habits, and important context here -->
<!-- The agent will read this file and inject it into every conversation -->

## Preferences

- 

## Notes

- 
`,
			'utf-8'
		);
	}
}

/** Read a memory file by relative path */
export async function readMemoryFile(relativePath: string): Promise<string> {
	const fullPath = join(MEMORY_DIR, relativePath);
	return await readFile(fullPath, 'utf-8');
}

/** Write a memory file by relative path, creating directories as needed */
export async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
	const fullPath = join(MEMORY_DIR, relativePath);
	const dir = dirname(fullPath);
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(fullPath, content, 'utf-8');
}

/** Delete a memory file or directory */
async function deleteMemoryFileFs(relativePath: string): Promise<void> {
	const fullPath = join(MEMORY_DIR, relativePath);
	const stats = await stat(fullPath);
	if (stats.isDirectory()) {
		await rm(fullPath, { recursive: true });
	} else {
		await unlink(fullPath);
	}
}

/** Recursively list all memory files as a tree */
async function listMemoryFilesInternal(dir?: string): Promise<FileNode[]> {
	await ensureMemoryDir();
	const targetDir = dir ? join(MEMORY_DIR, dir) : MEMORY_DIR;

	if (!existsSync(targetDir)) return [];

	const entries = await readdir(targetDir, { withFileTypes: true });
	const nodes: FileNode[] = [];

	// Sort: directories first, then alphabetical
	const sorted = entries.sort((a, b) => {
		if (a.isDirectory() && !b.isDirectory()) return -1;
		if (!a.isDirectory() && b.isDirectory()) return 1;
		return a.name.localeCompare(b.name);
	});

	for (const entry of sorted) {
		const relativePath = relative(MEMORY_DIR, join(targetDir, entry.name));

		if (entry.isDirectory()) {
			const children = await listMemoryFilesInternal(relativePath);
			nodes.push({
				name: entry.name,
				path: relativePath,
				type: 'directory',
				children
			});
		} else {
			nodes.push({
				name: entry.name,
				path: relativePath,
				type: 'file'
			});
		}
	}

	return nodes;
}

/** Read the profile.md file (always injected into system prompt) */
export async function getProfileMemory(): Promise<string | null> {
	try {
		await ensureMemoryDir();
		return await readMemoryFile('profile.md');
	} catch {
		return null;
	}
}

/** Get all markdown file paths recursively (flat list) */
export async function getAllMemoryFilePaths(dir?: string): Promise<string[]> {
	const targetDir = dir ? join(MEMORY_DIR, dir) : MEMORY_DIR;
	if (!existsSync(targetDir)) return [];

	const entries = await readdir(targetDir, { withFileTypes: true });
	const paths: string[] = [];

	for (const entry of entries) {
		const relativePath = relative(MEMORY_DIR, join(targetDir, entry.name));
		if (entry.isDirectory()) {
			const subPaths = await getAllMemoryFilePaths(relativePath);
			paths.push(...subPaths);
		} else if (entry.name.endsWith('.md')) {
			paths.push(relativePath);
		}
	}

	return paths;
}

// ============== PRIVATE: EMBEDDINGS ==============

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const EMBEDDING_URL = 'https://openrouter.ai/api/v1/embeddings';

interface EmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

/** Generate a single embedding vector for the given text */
async function generateEmbedding(text: string): Promise<number[]> {
	const [result] = await generateEmbeddings([text]);
	return result;
}

/** Generate embeddings for multiple texts in a single batch request */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const apiKey = env.OPENROUTER_API_KEY;
	if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

	const response = await fetch(EMBEDDING_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts,
			dimensions: EMBEDDING_DIMS
		})
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Embedding API error (${response.status}): ${err}`);
	}

	const data: EmbeddingResponse = await response.json();

	// Sort by index to ensure correct order
	const sorted = data.data.sort((a, b) => a.index - b.index);
	return sorted.map((d) => d.embedding);
}

// ============== PRIVATE: VECTOR STORE ==============

// Prepared statements for performance
const insertChunkStmt = vectorClient.prepare(`
	INSERT INTO memory_chunks (session_id, content, type, source, created_at)
	VALUES (?, ?, ?, ?, unixepoch())
`);

const insertEmbeddingStmt = vectorClient.prepare(`
	INSERT INTO memory_embeddings (chunk_id, embedding)
	VALUES (CAST(? AS INTEGER), ?)
`);

const searchStmt = vectorClient.prepare(`
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

const statsStmt = vectorClient.prepare(`
	SELECT type, COUNT(*) as count FROM memory_chunks GROUP BY type
`);

const totalStmt = vectorClient.prepare(`
	SELECT COUNT(*) as total FROM memory_chunks
`);

const deleteChunkStmt = vectorClient.prepare(`DELETE FROM memory_chunks WHERE id = ?`);
const deleteEmbeddingStmt = vectorClient.prepare(
	`DELETE FROM memory_embeddings WHERE chunk_id = ?`
);

/** Store a single text chunk with its embedding in the vector store */
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

/** Store multiple text chunks with their embeddings (batch) */
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

	const insertMany = vectorClient.transaction(() => {
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

/** Search the vector store for chunks semantically similar to the query */
export async function searchMemoryInternal(query: string, limit: number = 5): Promise<SearchResult[]> {
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

/** Delete a memory chunk and its embedding */
export function deleteChunk(id: number): void {
	deleteEmbeddingStmt.run(id);
	deleteChunkStmt.run(id);
}

/** Get vector store statistics */
function getStatsInternal(): VectorStats {
	const total = (totalStmt.get() as { total: number }).total;
	const byTypeRows = statsStmt.all() as Array<{ type: string; count: number }>;
	const byType: Record<string, number> = {};
	for (const row of byTypeRows) {
		byType[row.type] = row.count;
	}
	return { total, byType };
}

/** Chunk a conversation into overlapping segments for embedding */
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

// ============== PRIVATE: UTILITIES ==============

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

		const paragraphBreak = text.lastIndexOf('\n\n', end);
		if (paragraphBreak > start + chunkSize / 2) {
			end = paragraphBreak;
		} else {
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

// ============== QUERIES ==============

export const getFileTree = query(async () => {
	await ensureMemoryDir();
	return await listMemoryFilesInternal();
});

export const getFileContent = query(z.string(), async (path) => {
	try {
		return await readMemoryFile(path);
	} catch {
		throw new Error('File not found');
	}
});

const searchSchema = z.object({
	query: z.string().min(1),
	limit: z.number().optional().default(10)
});

export const searchMemory = query(searchSchema, async ({ query, limit }) => {
	return await searchMemoryInternal(query, limit);
});

export const getVectorStats = query(async () => {
	try {
		return getStatsInternal();
	} catch {
		return { total: 0, byType: {} };
	}
});

// ============== COMMANDS ==============

const createFileSchema = z.object({
	path: z.string().min(1),
	content: z.string().optional().default('')
});

export const createFile = command(createFileSchema, async ({ path, content }) => {
	await writeMemoryFile(path, content);
	await getFileTree().refresh();
	return { success: true, path };
});

const updateFileSchema = z.object({
	path: z.string().min(1),
	content: z.string()
});

export const updateFile = command(updateFileSchema, async ({ path, content }) => {
	await writeMemoryFile(path, content);
	await getFileContent(path).refresh();
	return { success: true, path };
});

export const deleteFile = command(z.string(), async (path) => {
	try {
		await deleteMemoryFileFs(path);
	} catch {
		throw new Error('File not found');
	}
	await getFileTree().refresh();
	return { success: true };
});

const uploadSchema = z.object({
	content: z.string().min(1),
	source: z.string().optional().default('Manual upload'),
	type: z.enum(['knowledge', 'note']).optional().default('knowledge')
});

export const uploadToVectorStore = command(uploadSchema, async ({ content, source, type }) => {
	const chunks = chunkText(content, 1500, 200);

	const chunkData = chunks.map((text) => ({
		content: text,
		meta: {
			type: type as MemoryType,
			source
		}
	}));

	const ids = await storeChunks(chunkData);
	await getVectorStats().refresh();

	return {
		success: true,
		chunksStored: ids.length,
		message: `Stored ${ids.length} chunks from "${source}"`
	};
});

const extractSchema = z.object({
	sessionId: z.string().min(1)
});

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the following conversation and extract ALL important information worth remembering long-term. This includes:

- User preferences and habits
- Technical decisions and architectural choices
- Key facts about the user or their projects
- Important decisions made during the conversation
- Useful knowledge or insights discussed
- Recipes, plans, or other structured information
- Action items or future tasks mentioned

Return a JSON array of objects with this structure:
[
  {
    "content": "The extracted fact or knowledge",
    "type": "knowledge" | "note",
    "suggestedPath": "optional/path/to/file.md (only for structured knowledge that deserves its own file)"
  }
]

Be thorough but avoid extracting trivial pleasantries. Focus on information that would be useful in future conversations. Return ONLY valid JSON, no markdown code fences.`;

export const extractMemories = command(extractSchema, async ({ sessionId }) => {
	// Load all messages from the session
	const messages = await db.query.message.findMany({
		where: eq(message.sessionId, sessionId),
		orderBy: (msg, { asc }) => [asc(msg.createdAt)]
	});

	if (messages.length === 0) {
		throw new Error('No messages found in session');
	}

	// Format conversation for extraction
	const conversationText = messages
		.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
		.join('\n\n');

	// Call LLM for extraction
	const apiKey = env.OPENROUTER_API_KEY;
	if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

	const extractionResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: 'openrouter/auto',
			messages: [
				{ role: 'system', content: EXTRACTION_PROMPT },
				{ role: 'user', content: conversationText }
			],
			stream: false
		})
	});

	if (!extractionResponse.ok) {
		throw new Error(`Extraction LLM call failed: ${extractionResponse.status}`);
	}

	const completion = await extractionResponse.json();
	const rawContent = completion.choices?.[0]?.message?.content || '[]';

	// Parse extracted items
	let extracted: Array<{
		content: string;
		type: MemoryType;
		suggestedPath?: string;
	}>;

	try {
		const cleaned = rawContent.replace(/```json\n?|\n?```/g, '').trim();
		extracted = JSON.parse(cleaned);
	} catch {
		throw new Error('Failed to parse extracted memories');
	}

	if (!Array.isArray(extracted) || extracted.length === 0) {
		return { extracted: [], chunksStored: 0, filesCreated: 0, message: 'No memories extracted' };
	}

	// Store chunks in vector store
	const chunkData = extracted.map((item) => ({
		content: item.content,
		meta: {
			sessionId,
			type: item.type || 'knowledge',
			source: `Extracted from session ${sessionId}`
		}
	}));

	const ids = await storeChunks(chunkData);

	// Create markdown files for items with suggested paths
	let filesCreated = 0;
	for (const item of extracted) {
		if (item.suggestedPath) {
			try {
				const path = item.suggestedPath.endsWith('.md')
					? item.suggestedPath
					: `${item.suggestedPath}.md`;
				await writeMemoryFile(
					path,
					`# ${item.suggestedPath.split('/').pop()?.replace('.md', '') || 'Note'}\n\n${item.content}\n`
				);
				filesCreated++;
			} catch (err) {
				console.error('Failed to create memory file:', err);
			}
		}
	}

	await getFileTree().refresh();
	await getVectorStats().refresh();

	return {
		extracted: extracted.map((e) => e.content),
		chunksStored: ids.length,
		filesCreated,
		message: `Extracted ${ids.length} memories${filesCreated > 0 ? ` and created ${filesCreated} note files` : ''}`
	};
});
