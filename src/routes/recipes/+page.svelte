<script lang="ts">
	import NavMenu from '$lib/components/NavMenu.svelte';
	import GeometricPattern from '$lib/components/GeometricPattern.svelte';
	import RecipeCard from '$lib/recipes/RecipeCard.svelte';
	import RecipeDetail from '$lib/recipes/RecipeDetail.svelte';
	import RecipeCarousel from '$lib/recipes/RecipeCarousel.svelte';
	import MealPlanWeek from '$lib/recipes/MealPlanWeek.svelte';
	import ShoppingListPanel from '$lib/recipes/ShoppingListPanel.svelte';
	import RecipeImportModal from '$lib/recipes/RecipeImportModal.svelte';
	import {
		getRecipes,
		getFavoriteRecipes,
		getCurrentMealPlan,
		getMealPlanHistory,
		getShoppingListForPlan,
		type RecipeData,
		type MealPlanWithRecipes
	} from '$lib/recipes/recipes.remote';
	import { getAgents, createAgent, updateAgent, runAgentNow } from '$lib/agents/agents.remote';

	let allRecipes = $state<RecipeData[]>([]);
	let favorites = $state<RecipeData[]>([]);
	let currentPlan = $state<MealPlanWithRecipes | null>(null);
	let pastPlans = $state<MealPlanWithRecipes[]>([]);
	let currentShoppingList = $state<Awaited<ReturnType<typeof getShoppingListForPlan>> | null>(null);

	let isLoading = $state(true);
	let selectedRecipe = $state<RecipeData | null>(null);
	let detailOpen = $state(false);
	let importModalOpen = $state(false);
	let activeView: 'week' | 'all' | 'favorites' = $state('week');
	let isRunningPlanner = $state(false);
	let plannerStatus = $state<string>('');

	// Load data on mount
	$effect(() => {
		loadData();
	});

	// Poll every 30s for updates (agent might create a new plan)
	$effect(() => {
		const interval = setInterval(loadData, 30000);
		return () => clearInterval(interval);
	});

	async function loadData() {
		try {
			const [recipesRes, favRes, planRes, historyRes] = await Promise.all([
				getRecipes(),
				getFavoriteRecipes(),
				getCurrentMealPlan(),
				getMealPlanHistory()
			]);
			allRecipes = recipesRes;
			favorites = favRes;
			currentPlan = planRes as unknown as MealPlanWithRecipes | null;
			pastPlans = historyRes as unknown as MealPlanWithRecipes[];

			// Load shopping list for current plan
			if (currentPlan) {
				try {
					currentShoppingList = await getShoppingListForPlan(currentPlan.id);
				} catch {
					currentShoppingList = null;
				}
			}
		} catch (error) {
			console.error('Failed to load recipe data:', error);
		} finally {
			isLoading = false;
		}
	}

	function openRecipeDetail(recipe: RecipeData) {
		selectedRecipe = recipe;
		detailOpen = true;
	}

	async function handleImportUrl(url: string) {
		// Navigate to chat with the meal-planner agent mention
		window.location.href = `/?prefill=${encodeURIComponent(`@meal-planner Please extract and save this recipe: ${url}`)}`;
	}

	function formatWeekRange(startDate: string): string {
		const start = new Date(startDate + 'T00:00:00');
		const end = new Date(start); // eslint-disable-line svelte/prefer-svelte-reactivity
		end.setDate(end.getDate() + 6);
		const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
		return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
	}

	const MEAL_PLANNER_PROMPT = `You are a Meal Planner agent responsible for creating delicious weekly dinner plans.

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

## When User Sends Recipe URLs
If the user sends you a recipe URL via chat (@meal-planner), use browse_url to extract the recipe, then save_recipe to store it. Confirm what was saved.`;

	const FRED_MEYER_CART_PROMPT = `You are the Fred Meyer Cart agent. Your job is to add approved shopping list items to the Fred Meyer online cart using browser automation.

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

	async function ensureFredMeyerCartAgent() {
		const agents = await getAgents();
		const cartAgent = agents.find((a) => a.name === 'Fred Meyer Cart');
		if (!cartAgent) {
			await createAgent({
				name: 'Fred Meyer Cart',
				description:
					'Adds approved shopping list items to Fred Meyer online cart via browser automation. Triggered automatically when a shopping list is approved.',
				systemPrompt: FRED_MEYER_CART_PROMPT,
				cronSchedule: '',
				model: 'moonshotai/kimi-k2.5',
				enabled: true
			});
		} else {
			await updateAgent({ id: cartAgent.id, systemPrompt: FRED_MEYER_CART_PROMPT });
		}
	}

	async function handleRunMealPlanner() {
		isRunningPlanner = true;
		plannerStatus = 'Checking for Meal Planner agent...';
		try {
			// Ensure Fred Meyer Cart agent exists in parallel
			ensureFredMeyerCartAgent().catch((err) =>
				console.warn('Failed to ensure Fred Meyer Cart agent:', err)
			);

			const agents = await getAgents();
			let mealPlanner: (typeof agents)[number] | undefined = agents.find(
				(a) => a.name === 'Meal Planner'
			);

			if (!mealPlanner) {
				plannerStatus = 'Creating Meal Planner agent...';
				const newAgent = await createAgent({
					name: 'Meal Planner',
					description:
						'Creates weekly meal plans with 5 dinners, searches for real recipes, builds shopping lists, and adds items to Fred Meyer cart when approved.',
					systemPrompt: MEAL_PLANNER_PROMPT,
					cronSchedule: '0 9 * * 6',
					model: 'moonshotai/kimi-k2.5',
					enabled: true
				});
				await runAgentNow(newAgent.id);
			} else {
				// Always sync the system prompt to the latest version
				await updateAgent({ id: mealPlanner.id, systemPrompt: MEAL_PLANNER_PROMPT });
				plannerStatus = 'Running Meal Planner...';
				await runAgentNow(mealPlanner.id);
			}
			plannerStatus = 'Meal Planner is running! Results will appear shortly.';

			// Poll more frequently while running
			const pollInterval = setInterval(async () => {
				await loadData();
				if (currentPlan) {
					clearInterval(pollInterval);
					plannerStatus = '';
					isRunningPlanner = false;
				}
			}, 5000);

			// Stop polling after 5 minutes max
			setTimeout(() => {
				clearInterval(pollInterval);
				if (isRunningPlanner) {
					plannerStatus = 'Meal Planner is still working. Check back soon!';
					isRunningPlanner = false;
				}
			}, 300000);
		} catch (error) {
			console.error('Failed to run meal planner:', error);
			plannerStatus = 'Failed to run Meal Planner. Check the console for details.';
			isRunningPlanner = false;
		}
	}
</script>

<div class="flex h-screen">
	<!-- Sidebar -->
	<div class="w-56 shrink-0">
		<NavMenu currentRoute="/recipes" />
	</div>

	<!-- Main content -->
	<div class="relative flex min-w-0 flex-1 flex-col">
		<!-- Full-page geometric background -->
		<div class="pointer-events-none absolute inset-0">
			<GeometricPattern variant="hexagons" opacity={0.06} />
		</div>
		<!-- Header -->
		<div class="relative z-10 flex items-center justify-between border-b border-base-300 px-6 py-3">
			<div class="flex items-center gap-4">
				<div>
					<h1 class="text-lg font-semibold">Recipes & Meal Planning</h1>
					<p class="text-sm opacity-50">
						{allRecipes.length} recipe{allRecipes.length !== 1 ? 's' : ''}
						{#if favorites.length > 0}
							· {favorites.length} favorite{favorites.length !== 1 ? 's' : ''}
						{/if}
						{#if currentPlan}
							· Week of {formatWeekRange(currentPlan.weekStartDate)}
						{/if}
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<!-- View toggle -->
				<div class="join">
					<button
						class="btn join-item btn-sm"
						class:btn-active={activeView === 'week'}
						onclick={() => (activeView = 'week')}
					>
						📅 This Week
					</button>
					<button
						class="btn join-item btn-sm"
						class:btn-active={activeView === 'all'}
						onclick={() => (activeView = 'all')}
					>
						📖 All Recipes
					</button>
					<button
						class="btn join-item btn-sm"
						class:btn-active={activeView === 'favorites'}
						onclick={() => (activeView = 'favorites')}
					>
						❤️ Favorites
					</button>
				</div>

				<div class="divider mx-0 divider-horizontal"></div>

				<button class="btn gap-2 btn-ghost btn-sm" onclick={() => (importModalOpen = true)}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-4 w-4"
					>
						<path
							d="M8.75 3.75a.75.75 0 00-1.5 0v3.5h-3.5a.75.75 0 000 1.5h3.5v3.5a.75.75 0 001.5 0v-3.5h3.5a.75.75 0 000-1.5h-3.5v-3.5z"
						/>
					</svg>
					Import URL
				</button>
			</div>
		</div>

		<!-- Content area -->
		<div class="relative z-10 flex-1 overflow-y-auto">
			{#if isLoading}
				<div class="flex items-center justify-center py-20">
					<span class="loading loading-lg loading-spinner"></span>
				</div>
			{:else if activeView === 'week'}
				<!-- ==================== WEEK VIEW ==================== -->
				<div class="space-y-8 p-6">
					<!-- Current Meal Plan -->
					{#if currentPlan && currentPlan.recipes.length > 0}
						<MealPlanWeek
							recipes={currentPlan.recipes}
							weekStartDate={currentPlan.weekStartDate}
							onSelectRecipe={openRecipeDetail}
						/>

						<!-- Shopping List -->
						{#if currentShoppingList}
							<ShoppingListPanel shoppingList={currentShoppingList} onUpdate={loadData} />
						{/if}
					{:else}
						<!-- Empty state — no current plan -->
						<div class="flex flex-col items-center justify-center py-24 text-center">
							<div
								class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-secondary/20 text-4xl"
							>
								🍽️
							</div>
							<h3
								class="mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-xl font-bold text-transparent"
							>
								No Meal Plan This Week
							</h3>
							<p class="mx-auto mb-6 max-w-md text-sm opacity-50">
								The Meal Planner agent runs every Saturday to create your weekly meal plan. You can
								also run it right now.
							</p>
							{#if plannerStatus}
								<div class="mb-4 flex items-center gap-2 text-sm text-primary">
									{#if isRunningPlanner}
										<span class="loading loading-xs loading-spinner"></span>
									{/if}
									{plannerStatus}
								</div>
							{/if}
							<div class="flex items-center justify-center gap-3">
								<button
									class="btn gap-2 btn-sm btn-primary"
									onclick={handleRunMealPlanner}
									disabled={isRunningPlanner}
								>
									{#if isRunningPlanner}
										<span class="loading loading-xs loading-spinner"></span>
									{:else}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											viewBox="0 0 16 16"
											fill="currentColor"
											class="h-4 w-4"
										>
											<path
												d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7-4a.75.75 0 01.75.75V8h3.25a.75.75 0 010 1.5H7.25V4.75A.75.75 0 018 4z"
											/>
										</svg>
									{/if}
									Run Meal Planner
								</button>
								<button class="btn btn-ghost btn-sm" onclick={() => (importModalOpen = true)}>
									Import a Recipe
								</button>
							</div>
						</div>
					{/if}

					<!-- Past Weeks -->
					{#if pastPlans.length > 0}
						<div class="space-y-6">
							<div class="flex items-center gap-3">
								<h2 class="text-xl font-bold">Previous Weeks</h2>
								<div class="h-px flex-1 bg-base-300"></div>
							</div>

							{#each pastPlans as plan (plan.id)}
								{@const planRecipes = plan.recipes.map((r) => r.recipe)}
								{#if planRecipes.length > 0}
									<RecipeCarousel
										recipes={planRecipes}
										label={formatWeekRange(plan.weekStartDate)}
										sublabel="{planRecipes.length} meal{planRecipes.length !== 1 ? 's' : ''}"
										onSelect={openRecipeDetail}
									/>
								{/if}
							{/each}
						</div>
					{/if}

					<!-- Favorites carousel -->
					{#if favorites.length > 0}
						<div>
							<div class="mb-4 flex items-center gap-3">
								<h2 class="text-xl font-bold">❤️ Favorites</h2>
								<div class="h-px flex-1 bg-base-300"></div>
								<button class="btn btn-ghost btn-xs" onclick={() => (activeView = 'favorites')}>
									View All →
								</button>
							</div>
							<RecipeCarousel recipes={favorites} onSelect={openRecipeDetail} />
						</div>
					{/if}
				</div>
			{:else if activeView === 'all'}
				<!-- ==================== ALL RECIPES VIEW ==================== -->
				<div class="p-6">
					{#if allRecipes.length === 0}
						<div class="flex flex-col items-center justify-center py-24 text-center">
							<div
								class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-secondary/20 text-4xl"
							>
								📖
							</div>
							<h3 class="mb-2 text-xl font-bold">No Recipes Yet</h3>
							<p class="mb-6 text-sm opacity-50">
								Import recipes from the web or let the Meal Planner agent find them for you.
							</p>
							<button class="btn btn-sm btn-primary" onclick={() => (importModalOpen = true)}>
								Import Your First Recipe
							</button>
						</div>
					{:else}
						<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each allRecipes as recipe (recipe.id)}
								<RecipeCard {recipe} onSelect={openRecipeDetail} />
							{/each}
						</div>
					{/if}
				</div>
			{:else if activeView === 'favorites'}
				<!-- ==================== FAVORITES VIEW ==================== -->
				<div class="p-6">
					{#if favorites.length === 0}
						<div class="flex flex-col items-center justify-center py-24 text-center">
							<div
								class="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-red-500/20 to-pink-500/20 text-4xl"
							>
								❤️
							</div>
							<h3 class="mb-2 text-xl font-bold">No Favorites Yet</h3>
							<p class="text-sm opacity-50">Heart recipes to save them here for quick access.</p>
						</div>
					{:else}
						<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each favorites as recipe (recipe.id)}
								<RecipeCard {recipe} onSelect={openRecipeDetail} />
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Recipe Detail Modal -->
{#if selectedRecipe}
	<RecipeDetail
		recipe={selectedRecipe}
		bind:open={detailOpen}
		onClose={() => {
			selectedRecipe = null;
		}}
		onUpdate={loadData}
	/>
{/if}

<!-- Import Modal -->
<RecipeImportModal
	bind:open={importModalOpen}
	onClose={() => {
		importModalOpen = false;
	}}
	onImport={handleImportUrl}
/>
