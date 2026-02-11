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
	import { getAgents, createAgent, runAgentNow } from '$lib/agents/agents.remote';

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

## Fred Meyer Cart

After creating the shopping list, it will appear as "pending" in the Recipes tab UI. The user will click "Approve" when ready. After approval, you may be asked to use browser tools to add items to the Fred Meyer online cart. Only do this when the list status is "approved".`;

	async function handleRunMealPlanner() {
		isRunningPlanner = true;
		plannerStatus = 'Checking for Meal Planner agent...';
		try {
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
