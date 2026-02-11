import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);

// Load sqlite-vec extension for vector search
sqliteVec.load(client);

// Initialize vec0 virtual table for embeddings (1536 dims for text-embedding-3-small)
client.exec(`
	CREATE TABLE IF NOT EXISTS memory_chunks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT,
		content TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'knowledge',
		source TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL DEFAULT (unixepoch())
	);
`);

client.exec(`
	CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
		chunk_id INTEGER PRIMARY KEY,
		embedding float[1536] distance_metric=cosine
	);
`);

export { client };
export const db = drizzle(client, { schema });
