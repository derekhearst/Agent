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
