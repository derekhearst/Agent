<script lang="ts">
	interface Session {
		id: string;
		sessionNumber: number;
		title: string;
		status: string;
		startedAt: string | null;
		endedAt: string | null;
		createdAt: string | Date;
	}

	interface Props {
		sessions: Session[];
		onSelect?: (session: Session) => void;
	}

	let { sessions, onSelect }: Props = $props();

	function statusIcon(status: string): string {
		switch (status) {
			case 'completed':
				return '✅';
			case 'active':
				return '🔴';
			case 'prep':
				return '📝';
			default:
				return '⏳';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'completed':
				return 'border-success bg-success/10';
			case 'active':
				return 'border-warning bg-warning/10';
			case 'prep':
				return 'border-info bg-info/10';
			default:
				return 'border-base-300 bg-base-200';
		}
	}

	function formatDate(d: string | Date | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	let sorted = $derived([...sessions].sort((a, b) => a.sessionNumber - b.sessionNumber));
</script>

<div class="flex flex-col gap-1">
	<h3 class="mb-2 text-xs font-semibold opacity-60">Session Timeline</h3>

	{#if sorted.length === 0}
		<p class="py-2 text-center text-xs opacity-40">No sessions yet</p>
	{:else}
		<div class="relative flex flex-col">
			{#each sorted as session, i (session.id)}
				<!-- Timeline connector line -->
				{#if i < sorted.length - 1}
					<div
						class="absolute left-3 ml-px h-full w-0.5 bg-base-300"
						style="top: {i * 52 + 20}px; height: 32px;"
					></div>
				{/if}

				<button
					class="relative mb-1 flex items-center gap-3 rounded-lg border p-2 text-left transition-colors hover:bg-base-200 {statusColor(
						session.status
					)}"
					onclick={() => onSelect?.(session)}
				>
					<!-- Timeline dot -->
					<div class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs">
						{statusIcon(session.status)}
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1">
							<span class="text-xs font-bold opacity-40">#{session.sessionNumber}</span>
							<span class="truncate text-xs font-medium">{session.title}</span>
						</div>
						<div class="text-xs opacity-40">
							{#if session.startedAt}
								{formatDate(session.startedAt)}
								{#if session.endedAt}→ {formatDate(session.endedAt)}{/if}
							{:else}
								{formatDate(session.createdAt)}
							{/if}
						</div>
					</div>

					<span class="badge badge-xs capitalize">{session.status}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
