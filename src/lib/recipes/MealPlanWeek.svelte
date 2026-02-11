<script lang="ts">
	import type { RecipeData } from '$lib/recipes/recipes.remote';
	import RecipeCard from './RecipeCard.svelte';

	interface MealPlanRecipeEntry {
		id: string;
		dayOfWeek: number;
		mealType: string;
		sortOrder: number;
		recipe: RecipeData;
	}

	interface Props {
		recipes: MealPlanRecipeEntry[];
		weekStartDate: string;
		onSelectRecipe?: (recipe: RecipeData) => void;
	}

	let { recipes, weekStartDate, onSelectRecipe }: Props = $props();

	const dayNames = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

	function formatWeekRange(startDate: string): string {
		const start = new Date(startDate + 'T00:00:00');
		const end = new Date(start); // eslint-disable-line svelte/prefer-svelte-reactivity
		end.setDate(end.getDate() + 6);
		const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
		return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
	}

	function getDateForDay(startDate: string, dayOfWeek: number): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const d = new Date(startDate + 'T00:00:00');
		d.setDate(d.getDate() + dayOfWeek);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Sort recipes by day of week
	let sortedRecipes = $derived([...recipes].sort((a, b) => a.dayOfWeek - b.dayOfWeek));

	// Check if today falls within this week
	let todayDayIndex = $derived(
		(() => {
			const start = new Date(weekStartDate + 'T00:00:00');
			const today = new Date();
			const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
			if (diff >= 0 && diff < 7) return diff;
			return -1;
		})()
	);
</script>

<div class="space-y-3">
	<div class="flex items-center gap-3 px-1">
		<h3 class="text-lg font-bold">This Week's Meals</h3>
		<span class="text-sm opacity-40">{formatWeekRange(weekStartDate)}</span>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
		{#each sortedRecipes as entry (entry.id)}
			{@const isToday = entry.dayOfWeek === todayDayIndex}
			<div class="relative">
				<!-- Day label -->
				<div class="mb-2 flex items-center gap-2 px-1">
					<span
						class="text-xs font-bold tracking-wider uppercase"
						class:text-primary={isToday}
						class:opacity-50={!isToday}
					>
						{dayNames[entry.dayOfWeek]}
					</span>
					<span class="text-xs opacity-30">{getDateForDay(weekStartDate, entry.dayOfWeek)}</span>
					{#if isToday}
						<span class="badge badge-xs badge-primary">Today</span>
					{/if}
				</div>

				<RecipeCard recipe={entry.recipe} onSelect={() => onSelectRecipe?.(entry.recipe)} />
			</div>
		{/each}

		<!-- Empty slots -->
		{#if sortedRecipes.length < 5}
			{#each Array(5 - sortedRecipes.length), i (i)}
				<!-- eslint-disable-line @typescript-eslint/no-unused-vars -->
				<div
					class="flex min-h-50 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-base-300 bg-base-200/30 p-6 text-center opacity-40"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="mb-2 h-8 w-8 opacity-30"
					>
						<path
							d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
						/>
					</svg>
					<span class="text-xs">No meal planned</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
