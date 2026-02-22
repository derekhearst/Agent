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
	model: text('model').notNull().default('moonshotai/kimi-k2.5'),
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
	model: text('model').notNull().default('moonshotai/kimi-k2.5'),
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

// ============== RECIPE / MEAL PLANNING SCHEMA ==============

// Recipes
export const recipe = sqliteTable('recipe', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	imageUrl: text('image_url'),
	sourceUrl: text('source_url'),
	source: text('source', { enum: ['web', 'atk', 'ai', 'user'] })
		.notNull()
		.default('ai'),
	cuisine: text('cuisine'),
	prepTime: integer('prep_time'), // minutes
	cookTime: integer('cook_time'), // minutes
	servings: integer('servings').notNull().default(2),
	// JSON: Array<{ stepNumber: number, title: string, description: string, duration?: string }>
	steps: text('steps').notNull().default('[]'),
	// JSON: Array<{ name: string, quantity: string, unit?: string, category?: string }>
	ingredients: text('ingredients').notNull().default('[]'),
	// JSON: Array<string>
	tags: text('tags').notNull().default('[]'),
	isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Meal plans (weekly)
export const mealPlan = sqliteTable('meal_plan', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	weekStartDate: text('week_start_date').notNull(), // ISO date "2026-02-09"
	mealCount: integer('meal_count').notNull().default(5),
	servingsPerMeal: integer('servings_per_meal').notNull().default(2),
	status: text('status', { enum: ['draft', 'active', 'completed'] })
		.notNull()
		.default('active'),
	agentRunId: text('agent_run_id'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Meal plan ↔ recipe join table
export const mealPlanRecipe = sqliteTable('meal_plan_recipe', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	mealPlanId: text('meal_plan_id')
		.notNull()
		.references(() => mealPlan.id, { onDelete: 'cascade' }),
	recipeId: text('recipe_id')
		.notNull()
		.references(() => recipe.id, { onDelete: 'cascade' }),
	dayOfWeek: integer('day_of_week').notNull(), // 0=Mon, 1=Tue ... 6=Sun
	mealType: text('meal_type').notNull().default('dinner'),
	sortOrder: integer('sort_order').notNull().default(0)
});

// Shopping lists
export const shoppingList = sqliteTable('shopping_list', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	mealPlanId: text('meal_plan_id')
		.notNull()
		.references(() => mealPlan.id, { onDelete: 'cascade' }),
	status: text('status', { enum: ['pending', 'approved', 'ordering', 'ordered', 'completed'] })
		.notNull()
		.default('pending'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Shopping list items
export const shoppingListItem = sqliteTable('shopping_list_item', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	shoppingListId: text('shopping_list_id')
		.notNull()
		.references(() => shoppingList.id, { onDelete: 'cascade' }),
	ingredientName: text('ingredient_name').notNull(),
	quantity: text('quantity').notNull(),
	unit: text('unit'),
	category: text('category').notNull().default('other'), // produce, dairy, meat, pantry, frozen, bakery, other
	checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
	recipeId: text('recipe_id').references(() => recipe.id, { onDelete: 'set null' })
});

// ============== DM ASSISTANT SCHEMA ==============

export const dmCampaign = sqliteTable('dm_campaign', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	chatSessionId: text('chat_session_id'),
	currentGameDay: integer('current_game_day').notNull().default(1),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmSource = sqliteTable('dm_source', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	content: text('content').notNull(),
	type: text('type', { enum: ['paste', 'file'] })
		.notNull()
		.default('paste'),
	vectorized: integer('vectorized', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmSession = sqliteTable('dm_session', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	sessionNumber: integer('session_number').notNull().default(1),
	title: text('title').notNull().default(''),
	status: text('status', { enum: ['prep', 'active', 'completed'] })
		.notNull()
		.default('prep'),
	prepContent: text('prep_content'),
	dmRecap: text('dm_recap'),
	playerRecap: text('player_recap'),
	nextSessionHooks: text('next_session_hooks'),
	chatSessionId: text('chat_session_id'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	startedAt: integer('started_at', { mode: 'timestamp' }),
	completedAt: integer('completed_at', { mode: 'timestamp' })
});

export const dmFaction = sqliteTable('dm_faction', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	reputation: integer('reputation').notNull().default(0),
	thresholdNotes: text('threshold_notes').notNull().default('[]'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmConsequence = sqliteTable('dm_consequence', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	sessionId: text('session_id'),
	action: text('action').notNull(),
	results: text('results').notNull().default('[]'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmQuest = sqliteTable('dm_quest', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	category: text('category', { enum: ['active_lead', 'hard_deadline', 'rumor', 'side_quest'] })
		.notNull()
		.default('active_lead'),
	deadline: text('deadline'),
	urgency: text('urgency', { enum: ['low', 'medium', 'high', 'critical'] })
		.notNull()
		.default('medium'),
	status: text('status', { enum: ['active', 'completed', 'failed', 'hidden'] })
		.notNull()
		.default('active'),
	relatedNpcIds: text('related_npc_ids').notNull().default('[]'),
	relatedItemIds: text('related_item_ids').notNull().default('[]'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmItem = sqliteTable('dm_item', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	mechanicalProperties: text('mechanical_properties').notNull().default(''),
	narrativeProperties: text('narrative_properties').notNull().default(''),
	origin: text('origin').notNull().default(''),
	currentHolder: text('current_holder'),
	isQuestGiver: integer('is_quest_giver', { mode: 'boolean' }).notNull().default(false),
	questHooks: text('quest_hooks').notNull().default('[]'),
	tags: text('tags').notNull().default('[]'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmNpc = sqliteTable('dm_npc', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	race: text('race'),
	description: text('description').notNull().default(''),
	location: text('location'),
	voice: text('voice').notNull().default(''),
	temperament: text('temperament').notNull().default(''),
	stance: text('stance').notNull().default('Neutral'),
	statusTags: text('status_tags').notNull().default('[]'),
	secrets: text('secrets').notNull().default(''),
	rumorPool: text('rumor_pool').notNull().default('[]'),
	factionId: text('faction_id'),
	alive: integer('alive', { mode: 'boolean' }).notNull().default(true),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmPartyMember = sqliteTable('dm_party_member', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	playerName: text('player_name').notNull(),
	characterName: text('character_name').notNull(),
	race: text('race'),
	class: text('class'),
	level: integer('level').notNull().default(1),
	backstoryHooks: text('backstory_hooks').notNull().default(''),
	notableItems: text('notable_items').notNull().default('[]'),
	relationships: text('relationships').notNull().default(''),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmLocation = sqliteTable('dm_location', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	locationType: text('location_type', {
		enum: ['city', 'town', 'village', 'dungeon', 'wilderness', 'building', 'region', 'other']
	})
		.notNull()
		.default('other'),
	description: text('description').notNull().default(''),
	parentLocationId: text('parent_location_id'),
	linkedNpcIds: text('linked_npc_ids').notNull().default('[]'),
	linkedQuestIds: text('linked_quest_ids').notNull().default('[]'),
	tags: text('tags').notNull().default('[]'),
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const dmCalendarEvent = sqliteTable('dm_calendar_event', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	gameDay: integer('game_day').notNull(),
	category: text('category', {
		enum: ['quest_deadline', 'festival', 'political', 'travel', 'combat', 'note']
	})
		.notNull()
		.default('note'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// ============== RELATIONS ==============

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

export const recipeRelations = relations(recipe, ({ many }) => ({
	mealPlanRecipes: many(mealPlanRecipe),
	shoppingListItems: many(shoppingListItem)
}));

export const mealPlanRelations = relations(mealPlan, ({ many }) => ({
	recipes: many(mealPlanRecipe),
	shoppingLists: many(shoppingList)
}));

export const mealPlanRecipeRelations = relations(mealPlanRecipe, ({ one }) => ({
	mealPlan: one(mealPlan, {
		fields: [mealPlanRecipe.mealPlanId],
		references: [mealPlan.id]
	}),
	recipe: one(recipe, {
		fields: [mealPlanRecipe.recipeId],
		references: [recipe.id]
	})
}));

export const shoppingListRelations = relations(shoppingList, ({ one, many }) => ({
	mealPlan: one(mealPlan, {
		fields: [shoppingList.mealPlanId],
		references: [mealPlan.id]
	}),
	items: many(shoppingListItem)
}));

export const shoppingListItemRelations = relations(shoppingListItem, ({ one }) => ({
	shoppingList: one(shoppingList, {
		fields: [shoppingListItem.shoppingListId],
		references: [shoppingList.id]
	}),
	recipe: one(recipe, {
		fields: [shoppingListItem.recipeId],
		references: [recipe.id]
	})
}));

// DM Relations
export const dmCampaignRelations = relations(dmCampaign, ({ many }) => ({
	sources: many(dmSource),
	sessions: many(dmSession),
	factions: many(dmFaction),
	consequences: many(dmConsequence),
	quests: many(dmQuest),
	items: many(dmItem),
	npcs: many(dmNpc),
	partyMembers: many(dmPartyMember),
	locations: many(dmLocation),
	calendarEvents: many(dmCalendarEvent)
}));

export const dmSourceRelations = relations(dmSource, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmSource.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmSessionRelations = relations(dmSession, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmSession.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmFactionRelations = relations(dmFaction, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmFaction.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmConsequenceRelations = relations(dmConsequence, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmConsequence.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmQuestRelations = relations(dmQuest, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmQuest.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmItemRelations = relations(dmItem, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmItem.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmNpcRelations = relations(dmNpc, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmNpc.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmPartyMemberRelations = relations(dmPartyMember, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmPartyMember.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmLocationRelations = relations(dmLocation, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmLocation.campaignId],
		references: [dmCampaign.id]
	})
}));

export const dmCalendarEventRelations = relations(dmCalendarEvent, ({ one }) => ({
	campaign: one(dmCampaign, {
		fields: [dmCalendarEvent.campaignId],
		references: [dmCampaign.id]
	})
}));

// ============== DATABASE CLIENTS ==============

// Main SQLite database (Drizzle)
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const client = new Database(env.DATABASE_URL);

// Auto-create tables if they don't exist (for fresh DBs, e.g. Docker)
client.exec(`
	CREATE TABLE IF NOT EXISTS task (
		id text PRIMARY KEY NOT NULL,
		title text NOT NULL,
		priority integer DEFAULT 1 NOT NULL
	);
	CREATE TABLE IF NOT EXISTS chat_session (
		id text PRIMARY KEY NOT NULL,
		title text DEFAULT 'New Chat' NOT NULL,
		model text DEFAULT 'openrouter/auto' NOT NULL,
		message_count integer DEFAULT 0 NOT NULL,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS message (
		id text PRIMARY KEY NOT NULL,
		session_id text NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
		role text NOT NULL,
		content text NOT NULL,
		model text,
		created_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS agent (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL UNIQUE,
		description text DEFAULT '' NOT NULL,
		system_prompt text NOT NULL,
		cron_schedule text NOT NULL,
		model text DEFAULT 'openrouter/auto' NOT NULL,
		memory_path text NOT NULL,
		enabled integer DEFAULT 1 NOT NULL,
		last_run_at integer,
		last_run_status text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS agent_run (
		id text PRIMARY KEY NOT NULL,
		agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
		status text NOT NULL,
		output text DEFAULT '' NOT NULL,
		tool_calls text,
		duration integer,
		started_at integer NOT NULL,
		completed_at integer,
		error text
	);
	CREATE TABLE IF NOT EXISTS models_cache (
		id text PRIMARY KEY NOT NULL,
		data text NOT NULL,
		fetched_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS recipe (
		id text PRIMARY KEY NOT NULL,
		title text NOT NULL,
		description text DEFAULT '' NOT NULL,
		image_url text,
		source_url text,
		source text DEFAULT 'ai' NOT NULL,
		cuisine text,
		prep_time integer,
		cook_time integer,
		servings integer DEFAULT 2 NOT NULL,
		steps text DEFAULT '[]' NOT NULL,
		ingredients text DEFAULT '[]' NOT NULL,
		tags text DEFAULT '[]' NOT NULL,
		is_favorite integer DEFAULT 0 NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS meal_plan (
		id text PRIMARY KEY NOT NULL,
		week_start_date text NOT NULL,
		meal_count integer DEFAULT 5 NOT NULL,
		servings_per_meal integer DEFAULT 2 NOT NULL,
		status text DEFAULT 'active' NOT NULL,
		agent_run_id text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS meal_plan_recipe (
		id text PRIMARY KEY NOT NULL,
		meal_plan_id text NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
		recipe_id text NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
		day_of_week integer NOT NULL,
		meal_type text DEFAULT 'dinner' NOT NULL,
		sort_order integer DEFAULT 0 NOT NULL
	);
	CREATE TABLE IF NOT EXISTS shopping_list (
		id text PRIMARY KEY NOT NULL,
		meal_plan_id text NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
		status text DEFAULT 'pending' NOT NULL,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS shopping_list_item (
		id text PRIMARY KEY NOT NULL,
		shopping_list_id text NOT NULL REFERENCES shopping_list(id) ON DELETE CASCADE,
		ingredient_name text NOT NULL,
		quantity text NOT NULL,
		unit text,
		category text DEFAULT 'other' NOT NULL,
		checked integer DEFAULT 0 NOT NULL,
		recipe_id text REFERENCES recipe(id) ON DELETE SET NULL
	);
	CREATE TABLE IF NOT EXISTS dm_campaign (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL,
		description text DEFAULT '' NOT NULL,
		chat_session_id text,
		current_game_day integer DEFAULT 1 NOT NULL,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_source (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		title text NOT NULL,
		content text NOT NULL,
		type text DEFAULT 'paste' NOT NULL,
		vectorized integer DEFAULT 0 NOT NULL,
		created_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_session (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		session_number integer DEFAULT 1 NOT NULL,
		title text DEFAULT '' NOT NULL,
		status text DEFAULT 'prep' NOT NULL,
		prep_content text,
		dm_recap text,
		player_recap text,
		next_session_hooks text,
		chat_session_id text,
		notes text,
		created_at integer NOT NULL,
		started_at integer,
		completed_at integer
	);
	CREATE TABLE IF NOT EXISTS dm_faction (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		name text NOT NULL,
		description text DEFAULT '' NOT NULL,
		reputation integer DEFAULT 0 NOT NULL,
		threshold_notes text DEFAULT '[]' NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_consequence (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		session_id text,
		action text NOT NULL,
		results text DEFAULT '[]' NOT NULL,
		created_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_quest (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		title text NOT NULL,
		description text DEFAULT '' NOT NULL,
		category text DEFAULT 'active_lead' NOT NULL,
		deadline text,
		urgency text DEFAULT 'medium' NOT NULL,
		status text DEFAULT 'active' NOT NULL,
		related_npc_ids text DEFAULT '[]' NOT NULL,
		related_item_ids text DEFAULT '[]' NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_item (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		name text NOT NULL,
		description text DEFAULT '' NOT NULL,
		mechanical_properties text DEFAULT '' NOT NULL,
		narrative_properties text DEFAULT '' NOT NULL,
		origin text DEFAULT '' NOT NULL,
		current_holder text,
		is_quest_giver integer DEFAULT 0 NOT NULL,
		quest_hooks text DEFAULT '[]' NOT NULL,
		tags text DEFAULT '[]' NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_npc (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		name text NOT NULL,
		race text,
		description text DEFAULT '' NOT NULL,
		location text,
		voice text DEFAULT '' NOT NULL,
		temperament text DEFAULT '' NOT NULL,
		stance text DEFAULT 'Neutral' NOT NULL,
		status_tags text DEFAULT '[]' NOT NULL,
		secrets text DEFAULT '' NOT NULL,
		rumor_pool text DEFAULT '[]' NOT NULL,
		faction_id text,
		alive integer DEFAULT 1 NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_party_member (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		player_name text NOT NULL,
		character_name text NOT NULL,
		race text,
		class text,
		level integer DEFAULT 1 NOT NULL,
		backstory_hooks text DEFAULT '' NOT NULL,
		notable_items text DEFAULT '[]' NOT NULL,
		relationships text DEFAULT '' NOT NULL,
		notes text,
		created_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_location (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		name text NOT NULL,
		location_type text DEFAULT 'other' NOT NULL,
		description text DEFAULT '' NOT NULL,
		parent_location_id text,
		linked_npc_ids text DEFAULT '[]' NOT NULL,
		linked_quest_ids text DEFAULT '[]' NOT NULL,
		tags text DEFAULT '[]' NOT NULL,
		notes text,
		created_at integer NOT NULL,
		updated_at integer NOT NULL
	);
	CREATE TABLE IF NOT EXISTS dm_calendar_event (
		id text PRIMARY KEY NOT NULL,
		campaign_id text NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
		title text NOT NULL,
		description text DEFAULT '' NOT NULL,
		game_day integer NOT NULL,
		category text DEFAULT 'note' NOT NULL,
		created_at integer NOT NULL
	);
`);

export { client };
export const db = drizzle(client, {
	schema: {
		task,
		chatSession,
		message,
		agent,
		agentRun,
		modelsCache,
		recipe,
		mealPlan,
		mealPlanRecipe,
		shoppingList,
		shoppingListItem,
		dmCampaign,
		dmSource,
		dmSession,
		dmFaction,
		dmConsequence,
		dmQuest,
		dmItem,
		dmNpc,
		dmPartyMember,
		dmLocation,
		dmCalendarEvent,
		chatSessionRelations,
		messageRelations,
		agentRelations,
		agentRunRelations,
		recipeRelations,
		mealPlanRelations,
		mealPlanRecipeRelations,
		shoppingListRelations,
		shoppingListItemRelations,
		dmCampaignRelations,
		dmSourceRelations,
		dmSessionRelations,
		dmFactionRelations,
		dmConsequenceRelations,
		dmQuestRelations,
		dmItemRelations,
		dmNpcRelations,
		dmPartyMemberRelations,
		dmLocationRelations,
		dmCalendarEventRelations
	}
});

// Initialize DM tables on first run
function initializeDmTables() {
	try {
		// Check if dm_location table exists, create if not
		const locationTableExists =
			client
				.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dm_location'`)
				.all().length > 0;
		if (!locationTableExists) {
			client.exec(`
				CREATE TABLE IF NOT EXISTS dm_location (
					id TEXT PRIMARY KEY,
					campaign_id TEXT NOT NULL,
					name TEXT NOT NULL,
					location_type TEXT DEFAULT 'city',
					description TEXT,
					parent_location_id TEXT,
					linked_npc_ids TEXT DEFAULT '[]',
					linked_quest_ids TEXT DEFAULT '[]',
					tags TEXT DEFAULT '[]',
					notes TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					FOREIGN KEY (campaign_id) REFERENCES dm_campaign(id) ON DELETE CASCADE,
					FOREIGN KEY (parent_location_id) REFERENCES dm_location(id) ON DELETE SET NULL
				);
			`);
		}

		// Check if dm_calendar_event table exists, create if not
		const calendarTableExists =
			client
				.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dm_calendar_event'`)
				.all().length > 0;
		if (!calendarTableExists) {
			client.exec(`
				CREATE TABLE IF NOT EXISTS dm_calendar_event (
					id TEXT PRIMARY KEY,
					campaign_id TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					game_day INTEGER NOT NULL,
					category TEXT DEFAULT 'note',
					created_at INTEGER NOT NULL,
					FOREIGN KEY (campaign_id) REFERENCES dm_campaign(id) ON DELETE CASCADE
				);
			`);
		}

		// Ensure dm_session has notes and dm_campaign has current_game_day columns
		const sessionColumns = client.prepare(`PRAGMA table_info(dm_session)`).all() as Array<{
			name: string;
		}>;
		const sessionHasNotes = sessionColumns.some((col) => col.name === 'notes');
		if (!sessionHasNotes) {
			client.exec(`ALTER TABLE dm_session ADD COLUMN notes TEXT;`);
		}

		const campaignColumns = client.prepare(`PRAGMA table_info(dm_campaign)`).all() as Array<{
			name: string;
		}>;
		const campaignHasGameDay = campaignColumns.some((col) => col.name === 'current_game_day');
		if (!campaignHasGameDay) {
			client.exec(
				`ALTER TABLE dm_campaign ADD COLUMN current_game_day INTEGER NOT NULL DEFAULT 1;`
			);
		}
	} catch (error) {
		console.error('Failed to initialize DM tables:', error);
	}
}

// Run initialization
initializeDmTables();

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
