<script lang="ts">
	interface PartyMember {
		id: string;
		campaignId: string;
		playerName: string;
		characterName: string;
		race: string | null;
		class: string | null;
		level: number;
		backstoryHooks: string;
		notableItems: string;
		relationships: string;
		notes: string | null;
	}

	interface Props {
		members: PartyMember[];
		onAdd: () => void;
		onEdit: (member: PartyMember) => void;
	}

	let { members, onAdd, onEdit }: Props = $props();

	let search = $state('');

	let filtered = $derived.by(() => {
		if (!search.trim()) return members;
		const q = search.toLowerCase();
		return members.filter(
			(m) =>
				m.characterName.toLowerCase().includes(q) ||
				m.playerName.toLowerCase().includes(q) ||
				(m.race?.toLowerCase().includes(q) ?? false) ||
				(m.class?.toLowerCase().includes(q) ?? false)
		);
	});

	function parseItems(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Party ({filtered.length})</h3>
		<div class="flex items-center gap-2">
			<input
				type="text"
				class="input-bordered input input-xs w-36"
				placeholder="Search party..."
				bind:value={search}
			/>
			<button class="btn btn-xs btn-primary" onclick={onAdd}>+ Member</button>
		</div>
	</div>

	{#if members.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No party members added yet.</p>
	{:else}
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
			{#each filtered as m (m.id)}
				{@const items = parseItems(m.notableItems)}
				<button
					class="rounded-box border border-base-300 bg-base-100 p-3 text-left transition-colors hover:border-primary/20"
					onclick={() => onEdit(m)}
				>
					<div class="flex items-center justify-between">
						<span class="text-sm font-semibold">{m.characterName}</span>
						<span class="badge badge-outline badge-xs">Lv {m.level}</span>
					</div>
					<div class="mt-0.5 text-xs opacity-50">
						{#if m.race || m.class}
							{m.race || ''} {m.class || ''} ·
						{/if}
						Player: {m.playerName}
					</div>

					{#if m.backstoryHooks}
						<div class="mt-2 text-xs">
							<span class="font-medium">🪝 Backstory:</span>
							{m.backstoryHooks}
						</div>
					{/if}

					{#if m.relationships}
						<div class="mt-1 text-xs">
							<span class="font-medium">🤝 Relations:</span>
							{m.relationships}
						</div>
					{/if}

					{#if items.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each items as item, i (i)}
								<span class="badge badge-ghost badge-xs">{item}</span>
							{/each}
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
