<script lang="ts">
	interface Props {
		factions: Array<{
			id: string;
			campaignId: string;
			name: string;
			description: string;
			reputation: number;
			thresholdNotes: string;
			notes: string | null;
		}>;
		onAdjust: (factionId: string, delta: number, reason: string) => Promise<void>;
		onAdd: () => void;
		onEdit: (faction: { id: string; name: string }) => void;
	}

	let { factions, onAdjust, onAdd, onEdit }: Props = $props();

	let adjustingId = $state<string | null>(null);
	let adjustDelta = $state(0);
	let adjustReason = $state('');

	function repColor(rep: number): string {
		if (rep >= 50) return 'bg-success';
		if (rep >= 20) return 'bg-info';
		if (rep >= -20) return 'bg-warning';
		if (rep >= -50) return 'bg-error/70';
		return 'bg-error';
	}

	function repLabel(faction: { reputation: number; thresholdNotes: string }): string {
		try {
			const thresholds = JSON.parse(faction.thresholdNotes) as Array<{ at: number; label: string }>;
			const sorted = thresholds.sort((a, b) => b.at - a.at);
			for (const t of sorted) {
				if (faction.reputation >= t.at) return t.label;
			}
		} catch {
			/* ignore */
		}

		if (faction.reputation >= 75) return 'Allied';
		if (faction.reputation >= 50) return 'Friendly';
		if (faction.reputation >= 20) return 'Warm';
		if (faction.reputation >= -20) return 'Neutral';
		if (faction.reputation >= -50) return 'Unfriendly';
		if (faction.reputation >= -75) return 'Hostile';
		return 'Enemy';
	}

	async function submitAdjust(factionId: string) {
		if (!adjustReason.trim() || adjustDelta === 0) return;
		await onAdjust(factionId, adjustDelta, adjustReason.trim());
		adjustingId = null;
		adjustDelta = 0;
		adjustReason = '';
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Faction Standings ({factions.length})</h3>
		<button class="btn btn-xs btn-primary" onclick={onAdd}>+ Faction</button>
	</div>

	{#if factions.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No factions tracked yet.</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each factions as faction (faction.id)}
				<div class="rounded-box border border-base-300 bg-base-100 p-3">
					<div class="flex items-center justify-between">
						<button class="text-sm font-medium hover:text-primary" onclick={() => onEdit(faction)}>
							{faction.name}
						</button>
						<span class="badge badge-outline badge-sm">{repLabel(faction)}</span>
					</div>

					<!-- Reputation bar -->
					<div class="mt-2 flex items-center gap-2">
						<span class="text-xs opacity-50">-100</span>
						<div class="relative h-3 flex-1 overflow-hidden rounded-full bg-base-300">
							<div
								class="absolute top-0 h-full transition-all duration-300 {repColor(
									faction.reputation
								)}"
								style="left: {Math.max(
									0,
									(faction.reputation + 100) / 2
								)}%; width: 2px; min-width: 8px; transform: translateX(-50%);"
							></div>
							<!-- Center marker -->
							<div class="absolute top-0 left-1/2 h-full w-px bg-base-content/20"></div>
						</div>
						<span class="text-xs opacity-50">+100</span>
						<span class="ml-1 min-w-8 text-right text-xs font-bold">
							{faction.reputation > 0 ? '+' : ''}{faction.reputation}
						</span>
					</div>

					{#if faction.description}
						<p class="mt-1 text-xs opacity-60">{faction.description}</p>
					{/if}

					<!-- Quick adjust -->
					{#if adjustingId === faction.id}
						<div class="mt-2 flex gap-2">
							<input
								type="number"
								class="input-bordered input input-xs w-16"
								bind:value={adjustDelta}
								placeholder="±"
							/>
							<input
								type="text"
								class="input-bordered input input-xs flex-1"
								bind:value={adjustReason}
								placeholder="Reason..."
							/>
							<button class="btn btn-xs btn-primary" onclick={() => submitAdjust(faction.id)}
								>Apply</button
							>
							<button class="btn btn-ghost btn-xs" onclick={() => (adjustingId = null)}>✕</button>
						</div>
					{:else}
						<button
							class="btn mt-1 opacity-50 btn-ghost btn-xs hover:opacity-100"
							onclick={() => (adjustingId = faction.id)}>± Adjust</button
						>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
