// Shared database setup — Drizzle ORM + sqlite-vec for vector storage
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

// ============== SCHEMA ==============

// Legacy table - can be removed later
export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

// Chat sessions
export const chatSession = sqliteTable('chat_session', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull().default('New Chat'),
	model: text('model').notNull().default('openrouter/auto'),
	messageCount: integer('message_count').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Chat messages
export const message = sqliteTable('message', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	sessionId: text('session_id')
		.notNull()
		.references(() => chatSession.id, { onDelete: 'cascade' }),
	role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
	content: text('content').notNull(),
	model: text('model'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Scheduled agents
export const agent = sqliteTable('agent', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull().unique(),
	description: text('description').notNull().default(''),
	systemPrompt: text('system_prompt').notNull(),
	cronSchedule: text('cron_schedule').notNull(),
	model: text('model').notNull().default('openrouter/auto'),
	memoryPath: text('memory_path').notNull(), // e.g. "agent/taskname"
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
	lastRunStatus: text('last_run_status', { enum: ['success', 'error', 'running'] }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Agent execution log
export const agentRun = sqliteTable('agent_run', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	agentId: text('agent_id')
		.notNull()
		.references(() => agent.id, { onDelete: 'cascade' }),
	status: text('status', { enum: ['running', 'success', 'error'] }).notNull(),
	output: text('output').notNull().default(''),
	toolCalls: text('tool_calls'), // JSON array of tool calls
	duration: integer('duration'), // milliseconds
	startedAt: integer('started_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	completedAt: integer('completed_at', { mode: 'timestamp' }),
	error: text('error')
});

// Models cache (replaces in-memory cache)
export const modelsCache = sqliteTable('models_cache', {
	id: text('id').primaryKey(),
	data: text('data').notNull(),
	fetchedAt: integer('fetched_at').notNull()
});

// Relations
export const chatSessionRelations = relations(chatSession, ({ many }) => ({
	messages: many(message)
}));

export const messageRelations = relations(message, ({ one }) => ({
	session: one(chatSession, {
		fields: [message.sessionId],
		references: [chatSession.id]
	})
}));

export const agentRelations = relations(agent, ({ many }) => ({
	runs: many(agentRun)
}));

export const agentRunRelations = relations(agentRun, ({ one }) => ({
	agent: one(agent, {
		fields: [agentRun.agentId],
		references: [agent.id]
	})
}));

// ============== DATABASE CLIENTS ==============

// Main SQLite database (Drizzle)
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = new Database(env.DATABASE_URL);

export { client };
export const db = drizzle(client, {
	schema: {
		task,
		chatSession,
		message,
		agent,
		agentRun,
		modelsCache,
		chatSessionRelations,
		messageRelations,
		agentRelations,
		agentRunRelations
	}
});

// Vector database (sqlite-vec)
if (!env.VECTOR_DB_URL) throw new Error('VECTOR_DB_URL is not set');
const vectorClient = new Database(env.VECTOR_DB_URL);

// Load sqlite-vec extension for vector search
sqliteVec.load(vectorClient);

// Initialize tables for memory chunks + vec0 virtual table for embeddings
vectorClient.exec(`
	CREATE TABLE IF NOT EXISTS memory_chunks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT,
		content TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'knowledge',
		source TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL DEFAULT (unixepoch())
	);
`);

vectorClient.exec(`
	CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
		chunk_id INTEGER PRIMARY KEY,
		embedding float[1536] distance_metric=cosine
	);
`);

export { vectorClient };
