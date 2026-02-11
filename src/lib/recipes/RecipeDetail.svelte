<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { RecipeData, RecipeStep, RecipeIngredient } from '$lib/recipes/recipes.remote';
	import { toggleFavorite, deleteRecipe } from '$lib/recipes/recipes.remote';

	interface Props {
		recipe: RecipeData;
		open: boolean;
		onClose: () => void;
		onUpdate?: () => void;
	}

	let { recipe, open = $bindable(false), onClose, onUpdate }: Props = $props();

	let steps: RecipeStep[] = $derived(
		(() => {
			try {
				return JSON.parse(recipe.steps || '[]');
			} catch {
				return [];
			}
		})()
	);

	let ingredients: RecipeIngredient[] = $derived(
		(() => {
			try {
				return JSON.parse(recipe.ingredients || '[]');
			} catch {
				return [];
			}
		})()
	);

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

	// Group ingredients by category
	let ingredientsByCategory = $derived(
		(() => {
			const groups = new SvelteMap<string, RecipeIngredient[]>();
			for (const ing of ingredients) {
				const cat = ing.category || 'other';
				if (!groups.has(cat)) groups.set(cat, []);
				groups.get(cat)!.push(ing);
			}
			return groups;
		})()
	);

	const categoryLabels: Record<string, string> = {
		produce: '🥬 Produce',
		dairy: '🧀 Dairy',
		meat: '🥩 Meat & Poultry',
		seafood: '🐟 Seafood',
		pantry: '🥫 Pantry',
		frozen: '🧊 Frozen',
		bakery: '🍞 Bakery',
		spices: '🌶️ Spices & Seasonings',
		condiments: '🫙 Condiments',
		other: '📦 Other'
	};

	let activeTab: 'steps' | 'ingredients' | 'notes' = $state('steps');
	let isDeleting = $state(false);

	async function handleFavorite() {
		try {
			await toggleFavorite(recipe.id);
			recipe.isFavorite = !recipe.isFavorite;
			onUpdate?.();
		} catch (err) {
			console.error('Failed to toggle favorite:', err);
		}
	}

	async function handleDelete() {
		if (!confirm('Delete this recipe? This cannot be undone.')) return;
		isDeleting = true;
		try {
			await deleteRecipe(recipe.id);
			open = false;
			onClose();
			onUpdate?.();
		} catch (err) {
			console.error('Failed to delete recipe:', err);
		} finally {
			isDeleting = false;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			open = false;
			onClose();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm md:p-8"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && ((open = false), onClose())}
	>
		<div
			class="relative w-full max-w-4xl animate-[slideUp_0.3s_ease-out] rounded-3xl bg-base-100 shadow-2xl"
		>
			<!-- Hero image -->
			<div class="relative h-64 overflow-hidden rounded-t-3xl md:h-80">
				{#if recipe.imageUrl}
					<img src={recipe.imageUrl} alt={recipe.title} class="h-full w-full object-cover" />
				{:else}
					<div
						class="flex h-full w-full items-center justify-center bg-linear-to-br from-primary/20 via-secondary/20 to-accent/20"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="currentColor"
							class="h-20 w-20 opacity-10"
						>
							<path
								d="M15 2a3 3 0 013 3v1h1a3 3 0 013 3v2.268a2 2 0 01-1.268 1.86l-.732.293V20a2 2 0 01-2 2H6a2 2 0 01-2-2v-6.579l-.732-.293A2 2 0 012 11.268V9a3 3 0 013-3h1V5a3 3 0 013-3h6z"
							/>
						</svg>
					</div>
				{/if}

				<div
					class="absolute inset-0 bg-linear-to-t from-base-100 via-transparent to-black/30"
				></div>

				<!-- Top bar actions -->
				<div class="absolute top-4 right-4 left-4 flex items-center justify-between">
					<button
						class="btn btn-circle border-0 bg-base-100/60 backdrop-blur-md btn-sm hover:bg-base-100/90"
						onclick={() => {
							open = false;
							onClose();
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="h-5 w-5"
						>
							<path
								d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
							/>
						</svg>
					</button>

					<div class="flex items-center gap-2">
						{#if recipe.sourceUrl}
							<a
								href={recipe.sourceUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-circle border-0 bg-base-100/60 backdrop-blur-md btn-sm hover:bg-base-100/90"
								onclick={(e) => e.stopPropagation()}
								title="View original recipe"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
									/>
									<path
										d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
									/>
								</svg>
							</a>
						{/if}
						<button
							class="btn btn-circle border-0 backdrop-blur-md btn-sm {recipe.isFavorite
								? 'bg-red-500/90 text-white'
								: 'bg-base-100/60 hover:bg-red-500/90 hover:text-white'}"
							onclick={handleFavorite}
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
					</div>
				</div>

				<!-- Title overlay -->
				<div class="absolute right-0 bottom-0 left-0 p-6">
					<div class="flex items-end gap-3">
						<div class="flex-1">
							{#if recipe.source === 'atk'}
								<span class="mb-2 badge badge-sm font-bold badge-warning"
									>America's Test Kitchen</span
								>
							{:else if recipe.source === 'web'}
								<span class="mb-2 badge badge-sm badge-info">Web Recipe</span>
							{:else if recipe.source === 'ai'}
								<span class="mb-2 badge badge-sm badge-secondary">AI Generated</span>
							{/if}
							<h2 class="text-2xl font-bold text-base-content md:text-3xl">{recipe.title}</h2>
						</div>
					</div>
				</div>
			</div>

			<!-- Content -->
			<div class="p-6">
				<!-- Meta stats bar -->
				<div class="flex flex-wrap items-center gap-4 rounded-2xl bg-base-200/50 p-4 text-sm">
					{#if recipe.prepTime}
						<div class="flex items-center gap-2">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										fill-rule="evenodd"
										d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7.75-4.25a.75.75 0 00-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 000-1.5h-2.5v-3.5z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div>
								<div class="text-xs opacity-50">Prep</div>
								<div class="font-semibold">{recipe.prepTime} min</div>
							</div>
						</div>
					{/if}
					{#if recipe.cookTime}
						<div class="flex items-center gap-2">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/10 text-secondary"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										d="M5 3.25a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 015 3.25zM3.5 8a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5A.75.75 0 013.5 8zm-.75 4a.75.75 0 000 1.5h10.5a.75.75 0 000-1.5H2.75z"
									/>
								</svg>
							</div>
							<div>
								<div class="text-xs opacity-50">Cook</div>
								<div class="font-semibold">{recipe.cookTime} min</div>
							</div>
						</div>
					{/if}
					{#if totalTime > 0}
						<div class="flex items-center gap-2">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										fill-rule="evenodd"
										d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7-4a.75.75 0 01.75.75v2.69l1.78 1.78a.75.75 0 01-1.06 1.06l-2-2A.75.75 0 017 7.25v-3.5A.75.75 0 018 4z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div>
								<div class="text-xs opacity-50">Total</div>
								<div class="font-semibold">{totalTime} min</div>
							</div>
						</div>
					{/if}
					<div class="flex items-center gap-2">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10 text-info">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								fill="currentColor"
								class="h-4 w-4"
							>
								<path
									d="M8 8a3 3 0 100-6 3 3 0 000 6zM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 00-11.215 0c-.22.578.254 1.139.872 1.139h9.47z"
								/>
							</svg>
						</div>
						<div>
							<div class="text-xs opacity-50">Servings</div>
							<div class="font-semibold">{recipe.servings}</div>
						</div>
					</div>
					{#if recipe.cuisine}
						<div class="flex items-center gap-2">
							<div
								class="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="h-4 w-4"
								>
									<path
										fill-rule="evenodd"
										d="M15 8A7 7 0 111 8a7 7 0 0114 0zM8 4a.75.75 0 01.75.75V8h3.25a.75.75 0 010 1.5H7.25V4.75A.75.75 0 018 4z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div>
								<div class="text-xs opacity-50">Cuisine</div>
								<div class="font-semibold">{recipe.cuisine}</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Description -->
				{#if recipe.description}
					<p class="mt-4 text-base leading-relaxed opacity-70">{recipe.description}</p>
				{/if}

				<!-- Tags -->
				{#if tags.length > 0}
					<div class="mt-4 flex flex-wrap gap-2">
						{#each tags as tag (tag)}
							<span class="badge badge-outline badge-sm">{tag}</span>
						{/each}
					</div>
				{/if}

				<!-- Tabs -->
				<div class="mt-6 border-b border-base-300">
					<div class="flex gap-1">
						<button
							class="relative px-4 py-3 text-sm font-medium transition-colors"
							class:text-primary={activeTab === 'steps'}
							class:opacity-60={activeTab !== 'steps'}
							onclick={() => (activeTab = 'steps')}
						>
							Steps ({steps.length})
							{#if activeTab === 'steps'}
								<div class="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary"></div>
							{/if}
						</button>
						<button
							class="relative px-4 py-3 text-sm font-medium transition-colors"
							class:text-primary={activeTab === 'ingredients'}
							class:opacity-60={activeTab !== 'ingredients'}
							onclick={() => (activeTab = 'ingredients')}
						>
							Ingredients ({ingredients.length})
							{#if activeTab === 'ingredients'}
								<div class="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary"></div>
							{/if}
						</button>
						<button
							class="relative px-4 py-3 text-sm font-medium transition-colors"
							class:text-primary={activeTab === 'notes'}
							class:opacity-60={activeTab !== 'notes'}
							onclick={() => (activeTab = 'notes')}
						>
							Notes
							{#if activeTab === 'notes'}
								<div class="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-primary"></div>
							{/if}
						</button>
					</div>
				</div>

				<!-- Tab content -->
				<div class="mt-4 min-h-50">
					{#if activeTab === 'steps'}
						<div class="space-y-4">
							{#each steps as step, i (step.stepNumber ?? i)}
								<div
									class="group/step flex gap-4 rounded-xl p-4 transition-colors hover:bg-base-200/50"
								>
									<div
										class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary"
									>
										{step.stepNumber || i + 1}
									</div>
									<div class="flex-1">
										<h4 class="text-base font-semibold">{step.title}</h4>
										<p class="mt-1 text-sm leading-relaxed opacity-70">{step.description}</p>
										{#if step.duration || step.tips}
											<div class="mt-2 flex flex-wrap gap-2">
												{#if step.duration}
													<span class="badge badge-ghost badge-sm">⏱️ {step.duration}</span>
												{/if}
												{#if step.tips}
													<span class="badge badge-outline badge-sm badge-info">💡 {step.tips}</span
													>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{:else if activeTab === 'ingredients'}
						<div class="space-y-6">
							{#each [...ingredientsByCategory.entries()] as [category, items] (category)}
								<div>
									<h4 class="mb-3 text-sm font-semibold opacity-60">
										{categoryLabels[category] || category}
									</h4>
									<div class="grid grid-cols-1 gap-2 md:grid-cols-2">
										{#each items as ing (ing.name)}
											<div
												class="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-base-200/50"
											>
												<div class="h-2 w-2 shrink-0 rounded-full bg-primary/40"></div>
												<span class="font-medium">{ing.quantity} {ing.unit || ''}</span>
												<span class="opacity-70">{ing.name}</span>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{:else if activeTab === 'notes'}
						<div class="rounded-xl bg-base-200/50 p-4">
							{#if recipe.notes}
								<p class="text-sm leading-relaxed whitespace-pre-wrap">{recipe.notes}</p>
							{:else}
								<p class="text-sm italic opacity-40">
									No notes yet. Notes can be added by the meal planner agent or manually.
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Footer actions -->
				<div class="mt-6 flex items-center justify-between border-t border-base-300 pt-4">
					<button
						class="btn text-error btn-ghost btn-sm"
						onclick={handleDelete}
						disabled={isDeleting}
					>
						{isDeleting ? 'Deleting...' : 'Delete Recipe'}
					</button>
					<div class="text-xs opacity-30">
						Added {new Date(recipe.createdAt).toLocaleDateString()}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(24px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
