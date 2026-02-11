<script lang="ts">
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import {
		toggleShoppingItem,
		approveShoppingList,
		markShoppingComplete,
		type ShoppingListItemData
	} from '$lib/recipes/recipes.remote';

	interface ShoppingListWithItems {
		id: string;
		status: string;
		items: ShoppingListItemData[];
	}

	interface Props {
		shoppingList: ShoppingListWithItems;
		onUpdate?: () => void;
	}

	let { shoppingList, onUpdate }: Props = $props();

	let isApproving = $state(false);
	let isMarking = $state(false);
	let expandedCategories = new SvelteSet<string>();

	// Group items by category
	let itemsByCategory = $derived(
		(() => {
			const groups = new SvelteMap<string, ShoppingListItemData[]>();
			for (const item of shoppingList.items) {
				const cat = item.category || 'other';
				if (!groups.has(cat)) groups.set(cat, []);
				groups.get(cat)!.push(item);
			}
			return groups;
		})()
	);

	let checkedCount = $derived(shoppingList.items.filter((i) => i.checked).length);
	let totalCount = $derived(shoppingList.items.length);
	let progress = $derived(totalCount > 0 ? (checkedCount / totalCount) * 100 : 0);

	const categoryIcons: Record<string, string> = {
		produce: '🥬',
		dairy: '🧀',
		meat: '🥩',
		seafood: '🐟',
		pantry: '🥫',
		frozen: '🧊',
		bakery: '🍞',
		spices: '🌶️',
		condiments: '🫙',
		other: '📦'
	};

	const categoryLabels: Record<string, string> = {
		produce: 'Produce',
		dairy: 'Dairy & Eggs',
		meat: 'Meat & Poultry',
		seafood: 'Seafood',
		pantry: 'Pantry Staples',
		frozen: 'Frozen',
		bakery: 'Bakery',
		spices: 'Spices & Seasonings',
		condiments: 'Condiments & Sauces',
		other: 'Other'
	};

	const statusConfig: Record<string, { color: string; label: string; icon: string }> = {
		pending: { color: 'badge-warning', label: 'Awaiting Approval', icon: '⏳' },
		approved: { color: 'badge-info', label: 'Approved — Ready to Order', icon: '✅' },
		ordering: { color: 'badge-secondary', label: 'Adding to Cart...', icon: '🛒' },
		ordered: { color: 'badge-success', label: 'Ordered', icon: '📦' },
		completed: { color: 'badge-ghost', label: 'Done', icon: '✨' }
	};

	function toggleCategory(cat: string) {
		if (expandedCategories.has(cat)) {
			expandedCategories.delete(cat);
		} else {
			expandedCategories.add(cat);
		}
	}

	// Start with all categories expanded
	$effect(() => {
		if (expandedCategories.size === 0 && itemsByCategory.size > 0) {
			for (const key of itemsByCategory.keys()) {
				expandedCategories.add(key);
			}
		}
	});

	async function handleToggleItem(itemId: string) {
		try {
			await toggleShoppingItem(itemId);
			// Optimistic update
			const item = shoppingList.items.find((i) => i.id === itemId);
			if (item) item.checked = !item.checked;
			onUpdate?.();
		} catch (err) {
			console.error('Failed to toggle item:', err);
		}
	}

	async function handleApprove() {
		isApproving = true;
		try {
			await approveShoppingList(shoppingList.id);
			shoppingList.status = 'approved';
			onUpdate?.();
		} catch (err) {
			console.error('Failed to approve:', err);
		} finally {
			isApproving = false;
		}
	}

	async function handleMarkComplete() {
		isMarking = true;
		try {
			await markShoppingComplete(shoppingList.id);
			shoppingList.status = 'completed';
			onUpdate?.();
		} catch (err) {
			console.error('Failed to mark complete:', err);
		} finally {
			isMarking = false;
		}
	}

	let currentStatus = $derived(statusConfig[shoppingList.status] || statusConfig.pending);
</script>

<div class="overflow-hidden rounded-2xl border border-base-300 bg-base-200/30">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-base-300 px-5 py-4">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-lg">
				🛒
			</div>
			<div>
				<h3 class="font-bold">Shopping List</h3>
				<div class="flex items-center gap-2 text-sm">
					<span class="opacity-50">{checkedCount}/{totalCount} items</span>
					<span class="badge badge-xs {currentStatus.color}"
						>{currentStatus.icon} {currentStatus.label}</span
					>
				</div>
			</div>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-2">
			{#if shoppingList.status === 'pending'}
				<button class="btn gap-2 btn-sm btn-primary" onclick={handleApprove} disabled={isApproving}>
					{#if isApproving}
						<span class="loading loading-xs loading-spinner"></span>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="h-4 w-4"
						>
							<path
								fill-rule="evenodd"
								d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z"
								clip-rule="evenodd"
							/>
						</svg>
					{/if}
					Approve & Send to Fred Meyer
				</button>
			{:else if shoppingList.status === 'approved'}
				<div class="flex items-center gap-2">
					<span class="animate-pulse text-sm text-info"
						>Agent will add items to Fred Meyer cart...</span
					>
				</div>
			{:else if shoppingList.status === 'ordering'}
				<div class="flex items-center gap-2">
					<span class="loading loading-sm loading-spinner text-secondary"></span>
					<span class="text-sm text-secondary">Adding to cart...</span>
				</div>
			{:else if shoppingList.status === 'ordered'}
				<button class="btn btn-sm btn-success" onclick={handleMarkComplete} disabled={isMarking}>
					Mark as Done
				</button>
			{/if}
		</div>
	</div>

	<!-- Progress bar -->
	{#if totalCount > 0}
		<div class="h-1 bg-base-300">
			<div
				class="h-full bg-linear-to-r from-primary to-secondary transition-all duration-500"
				style="width: {progress}%"
			></div>
		</div>
	{/if}

	<!-- Items grouped by category -->
	<div class="divide-y divide-base-300/50">
		{#each [...itemsByCategory.entries()] as [category, items] (category)}
			{@const isExpanded = expandedCategories.has(category)}
			{@const categoryChecked = items.filter((i) => i.checked).length}

			<div>
				<!-- Category header -->
				<button
					class="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-base-200/50"
					onclick={() => toggleCategory(category)}
				>
					<span class="text-lg">{categoryIcons[category] || '📦'}</span>
					<span class="flex-1 text-sm font-semibold">
						{categoryLabels[category] || category}
					</span>
					<span class="text-xs opacity-40">{categoryChecked}/{items.length}</span>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-4 w-4 opacity-40 transition-transform duration-200"
						class:rotate-180={isExpanded}
					>
						<path
							fill-rule="evenodd"
							d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>

				<!-- Items -->
				{#if isExpanded}
					<div class="px-5 pb-3">
						{#each items as item (item.id)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-base-200/50"
								class:opacity-40={item.checked}
							>
								<input
									type="checkbox"
									class="checkbox checkbox-sm checkbox-primary"
									checked={item.checked}
									onchange={() => handleToggleItem(item.id)}
								/>
								<span class="flex-1 text-sm" class:line-through={item.checked}>
									<span class="font-medium">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
									<span class="ml-1 opacity-70">{item.ingredientName}</span>
								</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
