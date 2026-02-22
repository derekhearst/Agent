<script lang="ts">
	interface Campaign {
		id: string;
		name: string;
		description: string;
		sessionCount: number;
		hasSourceBooks: boolean;
		lastSession: { title: string; status: string; sessionNumber: number } | null;
		createdAt: Date | string;
	}

	interface Props {
		campaign: Campaign;
		onSelect: (id: string) => void;
		onDelete: (id: string) => void;
	}

	let { campaign, onSelect, onDelete }: Props = $props();

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function sessionStatusBadge(status: string): { cls: string; text: string } {
		switch (status) {
			case 'active':
				return { cls: 'badge-warning', text: 'In Session' };
			case 'completed':
				return { cls: 'badge-success', text: 'Completed' };
			default:
				return { cls: 'badge-info', text: 'Prepping' };
		}
	}
</script>

<div
	class="card cursor-pointer border border-base-300 bg-base-200 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
	role="button"
	tabindex="0"
	onclick={() => onSelect(campaign.id)}
	onkeydown={(e) => e.key === 'Enter' && onSelect(campaign.id)}
>
	<div class="card-body gap-3 p-4">
		<div class="flex items-start justify-between">
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-base font-semibold">{campaign.name}</h3>
				<p class="mt-0.5 line-clamp-2 text-sm opacity-60">
					{campaign.description || 'No description'}
				</p>
			</div>
			<div class="ml-2 text-3xl">🎲</div>
		</div>

		<div class="flex flex-wrap gap-2 text-xs">
			<span class="badge badge-outline badge-sm">
				{campaign.sessionCount} session{campaign.sessionCount !== 1 ? 's' : ''}
			</span>
			{#if campaign.hasSourceBooks}
				<span class="badge badge-outline badge-sm badge-accent">📚 Sources</span>
			{/if}
			{#if campaign.lastSession}
				{@const badge = sessionStatusBadge(campaign.lastSession.status)}
				<span class="badge badge-sm {badge.cls}">{badge.text}</span>
			{/if}
		</div>

		<div class="flex items-center justify-between text-xs opacity-40">
			<span>Created {formatDate(campaign.createdAt)}</span>
			<button
				class="btn text-error opacity-0 btn-ghost transition-opacity btn-xs group-hover:opacity-100 hover:opacity-100"
				onclick={(e) => {
					e.stopPropagation();
					onDelete(campaign.id);
				}}
			>
				Delete
			</button>
		</div>
	</div>
</div>
