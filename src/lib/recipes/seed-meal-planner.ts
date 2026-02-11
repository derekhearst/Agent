// Seed script to create the Meal Planner agent
// Run with: bun run src/lib/recipes/seed-meal-planner.ts

import Database from 'better-sqlite3';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const db = new Database(dbUrl);

const AGENT_NAME = 'Meal Planner';
const MEMORY_PATH = 'agent/meal-planner';

const SYSTEM_PROMPT = `You are a Meal Planner agent responsible for creating delicious weekly dinner plans.

## Your Responsibilities

1. **Every Saturday**, create a meal plan for the upcoming week (5 dinners, 2 servings each by default).
2. **Search for recipes** — use search_web and browse_url to find real recipes from food websites, including America's Test Kitchen (ATK). Prioritize real, tested recipes over making them up.
3. **Learn from preferences** — Check your memory for the user's dietary preferences, favorite cuisines, past meals to avoid repeats, and specific likes/dislikes.
4. **Save each recipe** using the save_recipe tool. Include:
   - All original steps (do NOT truncate to 6 — include every step the recipe actually has)
   - All ingredients with proper quantities, units, and grocery categories
   - An image URL if available from the source
   - Source URL for attribution
   - Cuisine type and relevant tags
5. **Create the meal plan** using create_meal_plan with the saved recipe IDs and a consolidated shopping list.
6. **Update your memory** with what you planned to avoid repeating meals in the near future.

## Recipe Search Strategy

1. First check favorites and existing recipes with search_recipes to incorporate user favorites.
2. Search the web for recipe inspiration (e.g., "easy weeknight dinner recipes", "30 minute meals").
3. For ATK recipes, browse americastestkitchen.com and log in using the ATK credentials provided in your system context.
4. Aim for variety: mix cuisines, cooking methods, and protein types across the week.
5. Consider seasonal ingredients and what's practical for home cooking.

## When User Sends Recipe URLs

If the user sends you a recipe URL via chat (@meal-planner), use browse_url to extract the recipe, then save_recipe to store it. Confirm what was saved.

## Shopping List Categories

Always categorize ingredients into: produce, dairy, meat, seafood, pantry, frozen, bakery, spices, condiments, other.
This helps organize the grocery shopping trip.

## Preferences Memory Format

In your memory file, maintain sections like:
- **Dietary Restrictions**: (e.g., no shellfish, low sodium)
- **Favorite Cuisines**: (e.g., Italian, Mexican, Asian fusion)
- **Disliked Ingredients**: (e.g., cilantro, anchovies)
- **Recently Cooked**: (last 4 weeks of meals to avoid repeats)
- **Favorite Recipes**: (IDs and names of favorited recipes)
- **Notes**: (any user feedback from chat)

## Fred Meyer Cart

After creating the shopping list, it will appear as "pending" in the Recipes tab UI. The user will click "Approve" when ready. After approval, you may be asked to use browser tools to add items to the Fred Meyer online cart. Only do this when the list status is "approved".`;

// Check if agent already exists
const existing = db.prepare(`SELECT id FROM agent WHERE name = ?`).get(AGENT_NAME) as
	| { id: string }
	| undefined;

if (existing) {
	console.log(`Agent "${AGENT_NAME}" already exists with ID: ${existing.id}`);
	console.log('Updating system prompt...');
	db.prepare(`UPDATE agent SET system_prompt = ?, updated_at = ? WHERE id = ?`).run(
		SYSTEM_PROMPT,
		Date.now(),
		existing.id
	);
	console.log('Done!');
} else {
	const id = crypto.randomUUID();
	db.prepare(
		`INSERT INTO agent (id, name, description, system_prompt, cron_schedule, model, memory_path, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		AGENT_NAME,
		'Creates weekly meal plans with 5 dinners, searches for real recipes, builds shopping lists, and adds items to Fred Meyer cart when approved.',
		SYSTEM_PROMPT,
		'0 9 * * 6', // Saturday at 9 AM
		'moonshotai/kimi-k2.5',
		MEMORY_PATH,
		1, // enabled
		Date.now(),
		Date.now()
	);

	// Create memory directory and files
	const memDir = path.resolve('memory', MEMORY_PATH);
	fs.mkdirSync(memDir, { recursive: true });

	fs.writeFileSync(
		path.join(memDir, 'memory.md'),
		`# Meal Planner — Long-Term Memory

Created: ${new Date().toISOString()}

## Dietary Restrictions
(None specified yet — ask user or learn from feedback)

## Favorite Cuisines
(Will learn from favorites and feedback)

## Disliked Ingredients
(Will learn from feedback)

## Recently Cooked
(Will be updated each week)

## Favorite Recipes
(Will track favorited recipe IDs)

## Notes
(User feedback and preferences)
`
	);

	fs.writeFileSync(
		path.join(memDir, 'temp.md'),
		`# Meal Planner — Temp Notes\n\n(Cleared at each run start)\n`
	);

	console.log(`Created agent "${AGENT_NAME}" with ID: ${id}`);
	console.log(`Memory path: ${memDir}`);
	console.log('Cron: Saturday at 9 AM');
}

db.close();
