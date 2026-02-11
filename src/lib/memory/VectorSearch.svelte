<script lang="ts">
	import { searchMemory } from '$lib/memory/memory.remote';
	import { SvelteSet } from 'svelte/reactivity';

	interface SearchResult {
		id: number;
		content: string;
		distance: number;
		type: string;
		source: string;
		createdAt: number;
	}

	let searchQuery = $state('');
	let results = $state<SearchResult[]>([]);
	let isSearching = $state(false);
	let hasSearched = $state(false);
	let searchLimit = $state(10);

	let expandedIds = new SvelteSet<number>();

	async function handleSearch() {
		if (!searchQuery.trim()) return;

		isSearching = true;
		hasSearched = true;

		try {
			results = await searchMemory({ query: searchQuery, limit: searchLimit });
		} catch (error) {
			console.error('Search failed:', error);
			results = [];
		} finally {
			isSearching = false;
		}
	}

	function toggleExpand(id: number) {
		if (expandedIds.has(id)) {
			expandedIds.delete(id);
		} else {
			expandedIds.add(id);
		}
	}

	function formatDate(unixSeconds: number): string {
		return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="flex h-full flex-col">
	<!-- Search bar -->
	<div class="border-b border-base-300 p-4">
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				handleSearch();
			}}
		>
			<input
				type="text"
				class="input-bordered input input-sm flex-1"
				placeholder="Search your memory..."
				bind:value={searchQuery}
			/>
			<select class="select-bordered select w-20 select-sm" bind:value={searchLimit}>
				<option value={5}>5</option>
				<option value={10}>10</option>
				<option value={20}>20</option>
			</select>
			<button
				class="btn btn-sm btn-primary"
				type="submit"
				disabled={isSearching || !searchQuery.trim()}
			>
				{#if isSearching}
					<span class="loading loading-xs loading-spinner"></span>
				{:else}
					Search
				{/if}
			</button>
		</form>
	</div>

	<!-- Results -->
	<div class="flex-1 overflow-y-auto p-4">
		{#if !hasSearched}
			<div class="flex h-full items-center justify-center">
				<div class="text-center">
					<div class="mb-2 text-4xl opacity-20">🔍</div>
					<p class="text-sm opacity-50">Search your vector memory</p>
					<p class="text-xs opacity-30">
						Find semantically similar content from past conversations and stored knowledge
					</p>
				</div>
			</div>
		{:else if results.length === 0 && !isSearching}
			<div class="py-8 text-center">
				<p class="text-sm opacity-50">No results found for "{searchQuery}"</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each results as result (result.id)}
					{@const similarity = Math.round((1 - result.distance) * 100)}
					<div class="rounded-lg bg-base-200 p-4">
						<div class="mb-2 flex items-center gap-2">
							<span
								class="badge badge-sm"
								class:badge-success={similarity >= 80}
								class:badge-warning={similarity >= 50 && similarity < 80}
								class:badge-ghost={similarity < 50}
							>
								{similarity}% match
							</span>
							<span class="badge badge-ghost badge-sm">{result.type}</span>
							<span class="flex-1"></span>
							<span class="text-xs opacity-40">{result.source}</span>
							<span class="text-xs opacity-40">{formatDate(result.createdAt)}</span>
						</div>
						<div class="text-sm" class:line-clamp-4={!expandedIds.has(result.id)}>
							{result.content}
						</div>
						{#if result.content.length > 200}
							<button
								class="mt-1 text-xs text-primary hover:underline"
								onclick={() => toggleExpand(result.id)}
							>
								{expandedIds.has(result.id) ? 'Show less' : 'Show more'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
