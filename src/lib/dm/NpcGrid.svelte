<script lang="ts">
	interface Npc {
		id: string;
		campaignId: string;
		name: string;
		race: string | null;
		description: string;
		location: string | null;
		voice: string;
		temperament: string;
		stance: string;
		statusTags: string;
		secrets: string;
		rumorPool: string;
		factionId: string | null;
		alive: boolean;
		notes: string | null;
	}

	interface Props {
		npcs: Npc[];
		factions: Array<{ id: string; name: string }>;
		onAdd: () => void;
		onEdit: (npc: Npc) => void;
		onToggleAlive: (npc: Npc) => Promise<void>;
	}

	let { npcs, factions, onAdd, onEdit, onToggleAlive }: Props = $props();

	let expandedId = $state<string | null>(null);
	let showDead = $state(false);
	let search = $state('');

	let filtered = $derived.by(() => {
		let list = showDead ? npcs : npcs.filter((n) => n.alive);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(n) =>
					n.name.toLowerCase().includes(q) ||
					(n.race?.toLowerCase().includes(q) ?? false) ||
					(n.location?.toLowerCase().includes(q) ?? false) ||
					n.stance.toLowerCase().includes(q) ||
					(factionName(n.factionId)?.toLowerCase().includes(q) ?? false)
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

	function parseRumors(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	function stanceBadge(stance: string): string {
		switch (stance.toLowerCase()) {
			case 'allied':
				return 'badge-success';
			case 'friendly':
				return 'badge-info';
			case 'hostile':
				return 'badge-error';
			case 'suspicious':
				return 'badge-warning';
			default:
				return 'badge-ghost';
		}
	}

	function factionName(factionId: string | null): string | null {
		if (!factionId) return null;
		return factions.find((f) => f.id === factionId)?.name || null;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">NPCs ({filtered.length})</h3>
		<div class="flex items-center gap-2">
			<input
				type="text"
				class="input-bordered input input-xs w-36"
				placeholder="Search NPCs..."
				bind:value={search}
			/>
			<label class="label gap-1 text-xs">
				<input type="checkbox" class="checkbox checkbox-xs" bind:checked={showDead} />
				Show dead
			</label>
			<button class="btn btn-xs btn-primary" onclick={onAdd}>+ NPC</button>
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No NPCs tracked yet.</p>
	{:else}
		<div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
			{#each filtered as npc (npc.id)}
				{@const tags = parseTags(npc.statusTags)}
				{@const rumors = parseRumors(npc.rumorPool)}
				{@const faction = factionName(npc.factionId)}
				<div
					class="rounded-box border border-base-300 bg-base-100 p-3 transition-colors hover:border-primary/20"
					class:opacity-50={!npc.alive}
				>
					<div class="flex items-start justify-between">
						<button class="text-left" onclick={() => onEdit(npc)}>
							<span class="text-sm font-semibold">{npc.name}</span>
							{#if npc.race}
								<span class="text-xs opacity-50"> ({npc.race})</span>
							{/if}
						</button>
						<div class="flex items-center gap-1">
							{#if !npc.alive}
								<span class="badge badge-xs badge-error">Dead</span>
							{/if}
							<span class="badge badge-xs {stanceBadge(npc.stance)}">{npc.stance}</span>
						</div>
					</div>

					{#if npc.location}
						<div class="mt-1 text-xs opacity-50">📍 {npc.location}</div>
					{/if}
					{#if faction}
						<div class="mt-0.5 text-xs opacity-50">🏛️ {faction}</div>
					{/if}

					{#if tags.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each tags as tag, i (i)}
								<span class="badge badge-outline badge-xs">{tag}</span>
							{/each}
						</div>
					{/if}

					<!-- Expandable details -->
					<button
						class="btn mt-2 w-full opacity-40 btn-ghost btn-xs hover:opacity-100"
						onclick={() => (expandedId = expandedId === npc.id ? null : npc.id)}
					>
						{expandedId === npc.id ? '▲ Less' : '▼ More'}
					</button>

					{#if expandedId === npc.id}
						<div class="mt-2 flex flex-col gap-2 border-t border-base-300 pt-2 text-xs">
							{#if npc.voice}
								<div><span class="font-medium">🗣️ Voice:</span> {npc.voice}</div>
							{/if}
							{#if npc.temperament}
								<div><span class="font-medium">💭 Temperament:</span> {npc.temperament}</div>
							{/if}
							{#if npc.description}
								<div><span class="font-medium">Description:</span> {npc.description}</div>
							{/if}
							{#if npc.secrets}
								<div class="rounded bg-warning/10 p-1">
									<span class="font-medium">🤫 Secrets:</span>
									{npc.secrets}
								</div>
							{/if}
							{#if rumors.length > 0}
								<div>
									<span class="font-medium">👂 Rumors:</span>
									<ul class="ml-4 list-disc">
										{#each rumors as rumor, i (i)}
											<li>{rumor}</li>
										{/each}
									</ul>
								</div>
							{/if}
							<div class="flex gap-2">
								<button class="btn btn-ghost btn-xs" onclick={() => onToggleAlive(npc)}>
									{npc.alive ? '💀 Kill' : '✨ Revive'}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
