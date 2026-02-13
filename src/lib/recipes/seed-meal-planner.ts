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

## CRITICAL WORKFLOW — Follow This Order

You MUST follow this exact workflow. Do NOT skip to the next phase until the current one is done.

### Phase 1: Check Existing (1-2 tool calls)
- Read your memory.md for preferences and recently cooked meals
- search_recipes to find existing saved favorites you can reuse

### Phase 2: Get 3 Recipes from America's Test Kitchen
You have a PAID ATK subscription — use it! This is your PRIMARY recipe source.
1. browse_url to https://www.americastestkitchen.com
2. If not logged in, navigate to the sign-in page and use browser_act to fill in the login form with the ATK credentials in your system context. Use CSS selectors like input[type="email"] and input[type="password"] for reliability.
3. Search or browse for recipes on ATK. Look for recipes that meet these criteria:
   - Can be done start-to-finish in ~40 minutes or less
   - Are SELF-CONTAINED — no sub-recipes for sauces, marinades, spice rubs, etc. Everything should be in one recipe.
   - Avoid recipes that require another ATK recipe as a component
   - NO GRILL RECIPES
4. When on a recipe page, use browser_extract to get the full ingredients, steps, AND the recipe image URL (look in the Images section of the extraction output)
5. Call save_recipe IMMEDIATELY after extracting each recipe. ALWAYS include:
   - source: "atk"
   - sourceUrl: the recipe page URL
   - imageUrl: the main recipe image URL from the extraction (look in the ### Images section)
   - All ingredients with quantities, units, and categories
   - All steps with detailed instructions
6. Use browser_act "go back" to return to the recipe list, then click the next recipe. This is faster than browse_url.

### Phase 3: Generate 2 AI Recipes
Create 2 original recipes from your own knowledge. These should:
- Complement the ATK recipes (different cuisines/proteins)
- Be completable in ~40 minutes
- Be self-contained with no sub-recipes
- Have detailed steps and precise ingredient quantities
Call save_recipe for each (source: "ai")

### Phase 4: Create the Meal Plan
- Call create_meal_plan with ALL 5 recipe IDs returned from save_recipe
- Set weekStartDate to the upcoming Saturday

### Phase 5: Update Memory
- Update memory.md with the recipes you planned to avoid repeats next week

## Key Rules
- You MUST call save_recipe for every recipe — if you don't, the recipes won't appear in the UI
- You MUST call create_meal_plan with the saved recipe IDs — if you don't, there's no meal plan
- PREFER ATK recipes — you are paying for the subscription!
- All recipes must be doable in ~40 minutes and SELF-CONTAINED (no sub-recipes)
- NO GRILL RECIPES — only stovetop, oven, microwave, and air fryer
- 2 servings per meal by default
- Mix cuisines and protein types for variety
- Categorize ingredients: produce, dairy, meat, seafood, pantry, frozen, bakery, spices, condiments, other

## Preferences Memory Format
In your memory file, maintain sections like:
- **Dietary Restrictions**: (e.g., no shellfish, low sodium)
- **Favorite Cuisines**: (e.g., Italian, Mexican, Asian fusion)
- **Disliked Ingredients**: (e.g., cilantro, anchovies)
- **Recently Cooked**: (last 4 weeks of meals to avoid repeats)
- **Favorite Recipes**: (IDs and names of favorited recipes)
- **Notes**: (any user feedback from chat)

## When User Sends Recipe URLs
If the user sends you a recipe URL via chat (@meal-planner), use browse_url to extract the recipe, then save_recipe to store it. Confirm what was saved.`;

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

// ============== Fred Meyer Cart Agent ==============

const CART_AGENT_NAME = 'Fred Meyer Cart';
const CART_MEMORY_PATH = 'agent/fred-meyer-cart';

const CART_SYSTEM_PROMPT = `You are the Fred Meyer Cart agent. Your job is to add approved shopping list items to the Fred Meyer online cart using browser automation.

## Workflow

1. Call get_approved_shopping_list to get the current approved shopping list and its items.
2. If no approved list exists, stop — there's nothing to do.
3. Call add_to_fred_meyer_cart with the shopping list ID to begin.
4. Use browse_url to navigate to https://www.fredmeyer.com
5. If not logged in, use browser_act to log in (check your memory for credentials or use the sign-in flow).
6. For EACH item on the shopping list:
   a. Use the search bar to search for the item (e.g., "chicken breast 2 lbs")
   b. Use browser_act to click "Add to Cart" on the best matching product
   c. If an exact match isn't found, pick the closest reasonable substitute
7. After all items are added, call complete_fred_meyer_order with the shopping list ID and a summary of what was added and any items that couldn't be found.
8. Update your memory.md with any notes (e.g., items that frequently fail to match).

## Key Rules
- Work through items systematically — don't skip any
- If a search returns no results, try a simpler search term (e.g., "garlic" instead of "3 cloves garlic")
- Prefer store brand / Kroger brand for pantry staples unless a specific brand is needed
- If you get stuck on login, note it in memory and move on
- Always call complete_fred_meyer_order when done, even if some items failed
- **DO NOT CHECKOUT OR PLACE AN ORDER** — only add items to the cart. The user will review and checkout manually.`;

const existingCart = db.prepare(`SELECT id FROM agent WHERE name = ?`).get(CART_AGENT_NAME) as
	| { id: string }
	| undefined;

if (existingCart) {
	console.log(`Agent "${CART_AGENT_NAME}" already exists with ID: ${existingCart.id}`);
	console.log('Updating system prompt...');
	db.prepare(`UPDATE agent SET system_prompt = ?, updated_at = ? WHERE id = ?`).run(
		CART_SYSTEM_PROMPT,
		Date.now(),
		existingCart.id
	);
	console.log('Done!');
} else {
	const cartId = crypto.randomUUID();
	db.prepare(
		`INSERT INTO agent (id, name, description, system_prompt, cron_schedule, model, memory_path, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		cartId,
		CART_AGENT_NAME,
		'Adds approved shopping list items to Fred Meyer online cart via browser automation. Triggered automatically when a shopping list is approved.',
		CART_SYSTEM_PROMPT,
		'', // No cron — triggered by shopping list approval
		'moonshotai/kimi-k2.5',
		CART_MEMORY_PATH,
		1, // enabled
		Date.now(),
		Date.now()
	);

	const cartMemDir = path.resolve('memory', CART_MEMORY_PATH);
	fs.mkdirSync(cartMemDir, { recursive: true });

	fs.writeFileSync(
		path.join(cartMemDir, 'memory.md'),
		`# Fred Meyer Cart — Long-Term Memory\n\nCreated: ${new Date().toISOString()}\n\n## Fred Meyer Login\n(Store login notes here)\n\n## Items That Failed to Match\n(Track items that need different search terms)\n\n## Notes\n\n`
	);

	fs.writeFileSync(
		path.join(cartMemDir, 'temp.md'),
		`# Fred Meyer Cart — Temp Notes\n\n(Cleared at each run start)\n`
	);

	console.log(`Created agent "${CART_AGENT_NAME}" with ID: ${cartId}`);
	console.log(`Memory path: ${cartMemDir}`);
}

db.close();
