// Schema-only file for drizzle-kit (no SvelteKit runtime imports)
// Keep in sync with db.ts table definitions!
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

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

export const agent = sqliteTable('agent', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull().unique(),
	description: text('description').notNull().default(''),
	systemPrompt: text('system_prompt').notNull(),
	cronSchedule: text('cron_schedule').notNull(),
	model: text('model').notNull().default('moonshotai/kimi-k2.5'),
	memoryPath: text('memory_path').notNull(),
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

export const agentRun = sqliteTable('agent_run', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	agentId: text('agent_id')
		.notNull()
		.references(() => agent.id, { onDelete: 'cascade' }),
	status: text('status', { enum: ['running', 'success', 'error'] }).notNull(),
	output: text('output').notNull().default(''),
	toolCalls: text('tool_calls'),
	duration: integer('duration'),
	startedAt: integer('started_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	completedAt: integer('completed_at', { mode: 'timestamp' }),
	error: text('error')
});

export const modelsCache = sqliteTable('models_cache', {
	id: text('id').primaryKey(),
	data: text('data').notNull(),
	fetchedAt: integer('fetched_at').notNull()
});

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
	prepTime: integer('prep_time'),
	cookTime: integer('cook_time'),
	servings: integer('servings').notNull().default(2),
	steps: text('steps').notNull().default('[]'),
	ingredients: text('ingredients').notNull().default('[]'),
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

export const mealPlan = sqliteTable('meal_plan', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	weekStartDate: text('week_start_date').notNull(),
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
	dayOfWeek: integer('day_of_week').notNull(),
	mealType: text('meal_type').notNull().default('dinner'),
	sortOrder: integer('sort_order').notNull().default(0)
});

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
	category: text('category').notNull().default('other'),
	checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
	recipeId: text('recipe_id').references(() => recipe.id, { onDelete: 'set null' })
});

// ============== DM ASSISTANT SCHEMA ==============

// DM Campaigns
export const dmCampaign = sqliteTable('dm_campaign', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	chatSessionId: text('chat_session_id'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// DM Source Books (raw content ingested into vector store)
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

// DM Sessions (linked to chat_session for conversation)
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
	nextSessionHooks: text('next_session_hooks'), // JSON array of 3 hook strings
	chatSessionId: text('chat_session_id'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	startedAt: integer('started_at', { mode: 'timestamp' }),
	completedAt: integer('completed_at', { mode: 'timestamp' })
});

// Faction Reputation Tracker
export const dmFaction = sqliteTable('dm_faction', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	reputation: integer('reputation').notNull().default(0), // -100 to +100
	thresholdNotes: text('threshold_notes').notNull().default('[]'), // JSON: [{at: number, label: string, effects: string}]
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Butterfly Effect / Consequence Log
export const dmConsequence = sqliteTable('dm_consequence', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	sessionId: text('session_id'),
	action: text('action').notNull(), // What the party did
	results: text('results').notNull().default('[]'), // JSON: [{description, affectedEntity, resolved}]
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Quest Dashboard
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
	deadline: text('deadline'), // e.g. "Festival of the Blazing Sun - 3 days"
	urgency: text('urgency', { enum: ['low', 'medium', 'high', 'critical'] })
		.notNull()
		.default('medium'),
	status: text('status', { enum: ['active', 'completed', 'failed', 'hidden'] })
		.notNull()
		.default('active'),
	relatedNpcIds: text('related_npc_ids').notNull().default('[]'), // JSON array
	relatedItemIds: text('related_item_ids').notNull().default('[]'), // JSON array
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Artifact / Item Intelligence
export const dmItem = sqliteTable('dm_item', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	campaignId: text('campaign_id')
		.notNull()
		.references(() => dmCampaign.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	mechanicalProperties: text('mechanical_properties').notNull().default(''), // stats, gold value, rules
	narrativeProperties: text('narrative_properties').notNull().default(''), // the "pull", flavor
	origin: text('origin').notNull().default(''), // provenance / legacy identification
	currentHolder: text('current_holder'), // which PC/NPC has it
	isQuestGiver: integer('is_quest_giver', { mode: 'boolean' }).notNull().default(false),
	questHooks: text('quest_hooks').notNull().default('[]'), // JSON: things it whispers/drives toward
	tags: text('tags').notNull().default('[]'), // JSON: ["cursed", "sentient", "fey"]
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// NPC Personality Vault
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
	voice: text('voice').notNull().default(''), // speech patterns, dialect, verbal tics
	temperament: text('temperament').notNull().default(''), // core personality
	stance: text('stance').notNull().default('Neutral'), // disposition toward party
	statusTags: text('status_tags').notNull().default('[]'), // JSON: ["Recovering", "Shamed"]
	secrets: text('secrets').notNull().default(''), // what they know that the party doesn't
	rumorPool: text('rumor_pool').notNull().default('[]'), // JSON: things they might let slip
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

// Party Member Tracker
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
	notableItems: text('notable_items').notNull().default('[]'), // JSON array
	relationships: text('relationships').notNull().default(''), // NPC relationships
	notes: text('notes'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});
