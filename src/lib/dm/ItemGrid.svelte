<script lang="ts">
	interface Item {
		id: string;
		campaignId: string;
		name: string;
		description: string;
		mechanicalProperties: string;
		narrativeProperties: string;
		origin: string;
		currentHolder: string | null;
		isQuestGiver: boolean;
		questHooks: string;
		tags: string;
		notes: string | null;
	}

	interface Props {
		items: Item[];
		onAdd: () => void;
		onEdit: (item: Item) => void;
	}

	let { items, onAdd, onEdit }: Props = $props();

	let filter = $state<'all' | 'quest'>('all');
	let search = $state('');

	let filtered = $derived.by(() => {
		let list = filter === 'quest' ? items.filter((i) => i.isQuestGiver) : items;
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(i) =>
					i.name.toLowerCase().includes(q) ||
					i.description.toLowerCase().includes(q) ||
					i.origin.toLowerCase().includes(q) ||
					(i.currentHolder?.toLowerCase().includes(q) ?? false)
			);
		}
		return list;
	});

	function parseTags(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	function parseHooks(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Items ({filtered.length})</h3>
		<div class="flex gap-2">
			<input
				type="text"
				class="input-bordered input input-xs w-36"
				placeholder="Search items..."
				bind:value={search}
			/>
			<select class="select-bordered select select-xs" bind:value={filter}>
				<option value="all">All</option>
				<option value="quest">Quest-Givers Only</option>
			</select>
			<button class="btn btn-xs btn-primary" onclick={onAdd}>+ Item</button>
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No items tracked yet.</p>
	{:else}
		<div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
			{#each filtered as item (item.id)}
				{@const tags = parseTags(item.tags)}
				{@const hooks = parseHooks(item.questHooks)}
				<button
					class="rounded-box border bg-base-100 p-3 text-left transition-colors hover:border-primary/20 {item.isQuestGiver
						? 'border-accent/40'
						: 'border-base-300'}"
					onclick={() => onEdit(item)}
				>
					<div class="flex items-start justify-between">
						<span class="text-sm font-semibold">{item.name}</span>
						{#if item.isQuestGiver}
							<span class="badge badge-xs badge-accent">Quest</span>
						{/if}
					</div>

					{#if item.origin}
						<div class="mt-1 text-xs opacity-50">Origin: {item.origin}</div>
					{/if}
					{#if item.currentHolder}
						<div class="text-xs opacity-50">Held by: {item.currentHolder}</div>
					{/if}

					{#if item.description}
						<p class="mt-1 line-clamp-2 text-xs opacity-60">{item.description}</p>
					{/if}

					{#if item.mechanicalProperties}
						<div class="mt-1 text-xs">
							<span class="font-medium">⚔️</span>
							{item.mechanicalProperties}
						</div>
					{/if}

					{#if item.narrativeProperties}
						<div class="mt-1 text-xs">
							<span class="font-medium">📖</span>
							{item.narrativeProperties}
						</div>
					{/if}

					{#if tags.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each tags as tag, i (i)}
								<span class="badge badge-outline badge-xs">{tag}</span>
							{/each}
						</div>
					{/if}

					{#if hooks.length > 0}
						<div class="mt-1 text-xs italic opacity-50">
							{hooks.length} quest hook{hooks.length !== 1 ? 's' : ''}
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
