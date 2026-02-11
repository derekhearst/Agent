<script lang="ts">
	import type { RecipeData } from '$lib/recipes/recipes.remote';
	import { toggleFavorite } from '$lib/recipes/recipes.remote';

	interface Props {
		recipe: RecipeData;
		onSelect?: (recipe: RecipeData) => void;
		compact?: boolean;
	}

	let { recipe, onSelect, compact = false }: Props = $props();

	let tags: string[] = $derived(
		(() => {
			try {
				return JSON.parse(recipe.tags || '[]');
			} catch {
				return [];
			}
		})()
	);

	let totalTime = $derived((recipe.prepTime || 0) + (recipe.cookTime || 0));

	let isFavoriting = $state(false);

	async function handleFavorite(e: Event) {
		e.stopPropagation();
		if (isFavoriting) return;
		isFavoriting = true;
		try {
			await toggleFavorite(recipe.id);
			recipe.isFavorite = !recipe.isFavorite;
		} catch (err) {
			console.error('Failed to toggle favorite:', err);
		} finally {
			isFavoriting = false;
		}
	}
</script>

<div
	class="group relative cursor-pointer overflow-hidden rounded-2xl border border-base-300 bg-base-200 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5"
	class:w-64={compact}
	class:min-w-64={compact}
	role="button"
	tabindex="0"
	onclick={() => onSelect?.(recipe)}
	onkeydown={(e) => e.key === 'Enter' && onSelect?.(recipe)}
>
	<!-- Image -->
	<div class="relative aspect-4/3 overflow-hidden bg-base-300">
		{#if recipe.imageUrl}
			<img
				src={recipe.imageUrl}
				alt={recipe.title}
				class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
				loading="lazy"
			/>
		{:else}
			<div
				class="flex h-full w-full items-center justify-center bg-linear-to-br from-primary/10 via-secondary/10 to-accent/10"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="currentColor"
					class="h-12 w-12 opacity-20"
				>
					<path
						d="M15 2a3 3 0 013 3v1h1a3 3 0 013 3v2.268a2 2 0 01-1.268 1.86l-.732.293V20a2 2 0 01-2 2H6a2 2 0 01-2-2v-6.579l-.732-.293A2 2 0 012 11.268V9a3 3 0 013-3h1V5a3 3 0 013-3h6z"
					/>
				</svg>
			</div>
		{/if}

		<!-- Gradient overlay -->
		<div class="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent"></div>

		<!-- Favorite button -->
		<button
			class="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 hover:scale-110 {recipe.isFavorite
				? 'bg-red-500/90 text-white'
				: 'bg-base-100/60 text-base-content/60 hover:bg-red-500/90 hover:text-white'}"
			onclick={handleFavorite}
			disabled={isFavoriting}
			title={recipe.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				class="h-5 w-5"
			>
				{#if recipe.isFavorite}
					<path
						d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0l-.003-.002z"
					/>
				{:else}
					<path
						d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0l-.003-.002zM10 4.981a3.5 3.5 0 00-6 2.519c0 2.27 1.714 4.319 3.44 5.795a20.953 20.953 0 002.56 1.889 20.953 20.953 0 002.56-1.889C14.286 11.819 16 9.77 16 7.5a3.5 3.5 0 00-6-2.519z"
					/>
				{/if}
			</svg>
		</button>

		<!-- Cuisine badge -->
		{#if recipe.cuisine}
			<div class="absolute bottom-3 left-3 z-10">
				<span class="badge border-0 bg-base-100/80 badge-sm font-medium backdrop-blur-md">
					{recipe.cuisine}
				</span>
			</div>
		{/if}

		<!-- Source badge -->
		{#if recipe.source === 'atk'}
			<div class="absolute top-3 left-3 z-10">
				<span class="badge badge-sm font-bold badge-warning">ATK</span>
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="p-4" class:p-3={compact}>
		<h3
			class="line-clamp-2 leading-tight font-semibold"
			class:text-base={!compact}
			class:text-sm={compact}
		>
			{recipe.title}
		</h3>

		{#if !compact && recipe.description}
			<p class="mt-1.5 line-clamp-2 text-sm leading-relaxed opacity-60">
				{recipe.description}
			</p>
		{/if}

		<!-- Meta row -->
		<div class="mt-3 flex items-center gap-3 text-xs opacity-50">
			{#if totalTime > 0}
				<span class="flex items-center gap-1">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-3.5 w-3.5"
					>
						<path
							fill-rule="evenodd"
							d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7.75-4.25a.75.75 0 00-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 000-1.5h-2.5v-3.5z"
							clip-rule="evenodd"
						/>
					</svg>
					{totalTime} min
				</span>
			{/if}
			{#if recipe.servings}
				<span class="flex items-center gap-1">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-3.5 w-3.5"
					>
						<path
							d="M8 8a3 3 0 100-6 3 3 0 000 6zM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 00-11.215 0c-.22.578.254 1.139.872 1.139h9.47z"
						/>
					</svg>
					{recipe.servings} servings
				</span>
			{/if}
		</div>

		<!-- Tags -->
		{#if tags.length > 0 && !compact}
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each tags.slice(0, 3) as tag (tag)}
					<span class="badge badge-outline badge-xs opacity-60">{tag}</span>
				{/each}
				{#if tags.length > 3}
					<span class="badge badge-ghost badge-xs opacity-40">+{tags.length - 3}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
