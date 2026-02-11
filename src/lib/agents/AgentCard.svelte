<script lang="ts">
	interface AgentData {
		id: string;
		name: string;
		description: string;
		cronSchedule: string;
		enabled: boolean;
		lastRunAt: Date | string | null;
		lastRunStatus: string | null;
		nextRun: string | null;
		lastRun: {
			id: string;
			status: string;
			output: string;
			duration: number | null;
			startedAt: Date | string;
		} | null;
	}

	interface Props {
		agent: AgentData;
		onSelect: (id: string) => void;
		onToggle: (id: string, enabled: boolean) => void;
		onRunNow: (id: string) => void;
	}

	let { agent, onSelect, onToggle, onRunNow }: Props = $props();

	let isRunning = $derived(agent.lastRunStatus === 'running');

	function formatRelativeTime(dateInput: Date | string | null): string {
		if (!dateInput) return 'Never';
		const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function formatNextRun(dateStr: string | null): string {
		if (!dateStr) return 'Not scheduled';
		const date = new Date(dateStr);
		const now = new Date();
		const diff = date.getTime() - now.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Any moment';
		if (mins < 60) return `in ${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `in ${hours}h`;
		const days = Math.floor(hours / 24);
		return `in ${days}d`;
	}

	function statusBadge(status: string | null): { class: string; text: string } {
		switch (status) {
			case 'success':
				return { class: 'badge-success', text: 'Success' };
			case 'error':
				return { class: 'badge-error', text: 'Error' };
			case 'running':
				return { class: 'badge-warning', text: 'Running' };
			default:
				return { class: 'badge-ghost', text: 'Idle' };
		}
	}
</script>

<div
	class="card cursor-pointer border border-base-300 bg-base-200 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
	class:border-warning={isRunning}
	class:animate-pulse={isRunning}
	role="button"
	tabindex="0"
	onclick={() => onSelect(agent.id)}
	onkeydown={(e) => e.key === 'Enter' && onSelect(agent.id)}
>
	<div class="card-body gap-3 p-4">
		<!-- Header -->
		<div class="flex items-start justify-between">
			<div class="min-w-0 flex-1">
				<h3 class="truncate text-base font-semibold">{agent.name}</h3>
				<p class="mt-0.5 line-clamp-2 text-sm opacity-60">
					{agent.description || 'No description'}
				</p>
			</div>
			<div class="ml-2 flex items-center gap-2">
				{#if agent.lastRunStatus}
					{@const badge = statusBadge(agent.lastRunStatus)}
					<span class="badge badge-sm {badge.class}">{badge.text}</span>
				{:else}
					<span class="badge badge-ghost badge-sm">Idle</span>
				{/if}
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={agent.enabled}
					onclick={(e) => {
						e.stopPropagation();
						e.preventDefault();
						onToggle(agent.id, !agent.enabled);
					}}
				/>
			</div>
		</div>

		<!-- Schedule -->
		<div class="flex flex-wrap items-center gap-3 text-xs opacity-60">
			<span class="flex items-center gap-1">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					fill="currentColor"
					class="h-3.5 w-3.5"
				>
					<path
						fill-rule="evenodd"
						d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8Zm7.75-4.25a.75.75 0 0 0-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 0 0 0-1.5h-2.5v-3.5Z"
						clip-rule="evenodd"
					/>
				</svg>
				{agent.cronSchedule}
			</span>
			<span class="text-xs opacity-50">
				Next: {formatNextRun(agent.nextRun)}
			</span>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t border-base-300 pt-2">
			<span class="text-xs opacity-50">
				Last: {formatRelativeTime(agent.lastRunAt)}
				{#if agent.lastRun?.duration}
					({(agent.lastRun.duration / 1000).toFixed(1)}s)
				{/if}
			</span>
			<button
				class="btn btn-ghost btn-xs"
				class:loading={isRunning}
				disabled={isRunning}
				onclick={(e) => {
					e.stopPropagation();
					onRunNow(agent.id);
				}}
			>
				{#if isRunning}
					Running...
				{:else}
					▶ Run Now
				{/if}
			</button>
		</div>
	</div>
</div>
