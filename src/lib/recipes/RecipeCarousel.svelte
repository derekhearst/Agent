<script lang="ts">
	import type { RecipeData } from '$lib/recipes/recipes.remote';
	import RecipeCard from './RecipeCard.svelte';

	interface Props {
		recipes: RecipeData[];
		label?: string;
		sublabel?: string;
		onSelect?: (recipe: RecipeData) => void;
	}

	let { recipes, label, sublabel, onSelect }: Props = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let canScrollLeft = $state(false);
	let canScrollRight = $state(true);

	function updateScrollState() {
		if (!scrollContainer) return;
		canScrollLeft = scrollContainer.scrollLeft > 10;
		canScrollRight =
			scrollContainer.scrollLeft < scrollContainer.scrollWidth - scrollContainer.clientWidth - 10;
	}

	function scroll(direction: 'left' | 'right') {
		if (!scrollContainer) return;
		const amount = scrollContainer.clientWidth * 0.75;
		scrollContainer.scrollBy({
			left: direction === 'left' ? -amount : amount,
			behavior: 'smooth'
		});
	}

	$effect(() => {
		if (scrollContainer) {
			updateScrollState();
		}
	});
</script>

<div class="group/carousel relative">
	{#if label}
		<div class="mb-3 flex items-baseline gap-3 px-1">
			<h3 class="text-lg font-bold">{label}</h3>
			{#if sublabel}
				<span class="text-sm opacity-40">{sublabel}</span>
			{/if}
		</div>
	{/if}

	<div class="relative">
		<!-- Left scroll button -->
		{#if canScrollLeft}
			<button
				class="absolute top-1/2 -left-3 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-base-300 bg-base-100 opacity-0 shadow-lg transition-all duration-200 group-hover/carousel:opacity-100 hover:scale-110 hover:bg-primary hover:text-primary-content"
				onclick={() => scroll('left')}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path
						fill-rule="evenodd"
						d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		{/if}

		<!-- Right scroll button -->
		{#if canScrollRight}
			<button
				class="absolute top-1/2 -right-3 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-base-300 bg-base-100 opacity-0 shadow-lg transition-all duration-200 group-hover/carousel:opacity-100 hover:scale-110 hover:bg-primary hover:text-primary-content"
				onclick={() => scroll('right')}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path
						fill-rule="evenodd"
						d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		{/if}

		<!-- Fade edges -->
		{#if canScrollLeft}
			<div
				class="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-12 bg-linear-to-r from-base-100 to-transparent"
			></div>
		{/if}
		{#if canScrollRight}
			<div
				class="pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-12 bg-linear-to-l from-base-100 to-transparent"
			></div>
		{/if}

		<!-- Scrollable container -->
		<div
			bind:this={scrollContainer}
			class="scrollbar-none flex gap-4 overflow-x-auto scroll-smooth pb-2"
			onscroll={updateScrollState}
		>
			{#each recipes as recipe (recipe.id)}
				<RecipeCard {recipe} compact onSelect={() => onSelect?.(recipe)} />
			{/each}
		</div>
	</div>
</div>

<style>
	.scrollbar-none {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-none::-webkit-scrollbar {
		display: none;
	}
</style>
