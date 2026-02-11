<script lang="ts">
	interface Session {
		id: string;
		title: string;
		messageCount: number;
		model: string;
		updatedAt: Date | string;
	}

	interface Props {
		sessions: Session[];
		activeSessionId: string | null;
		onSelect: (id: string) => void;
		onNew: () => void;
		onDelete: (id: string) => void;
	}

	let { sessions, activeSessionId, onSelect, onNew, onDelete }: Props = $props();

	function timeAgo(dateInput: Date | string): string {
		const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
		const now = new Date();
		const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
		return date.toLocaleDateString();
	}
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b border-base-300 p-3">
		<h2 class="text-sm font-semibold">Sessions</h2>
		<button class="btn btn-ghost btn-xs" onclick={onNew} title="New Chat">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				class="h-4 w-4"
			>
				<path
					d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
				/>
			</svg>
		</button>
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if sessions.length === 0}
			<div class="p-4 text-center text-xs opacity-50">No sessions yet</div>
		{:else}
			<ul class="menu w-full gap-0.5 menu-sm p-2">
				{#each sessions as session (session.id)}
					<li>
						<div
							class="group flex w-full cursor-pointer items-start justify-between rounded-lg px-3 py-2 text-left"
							class:active={session.id === activeSessionId}
							role="button"
							tabindex="0"
							onclick={() => onSelect(session.id)}
							onkeydown={(e) => e.key === 'Enter' && onSelect(session.id)}
						>
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm">{session.title}</div>
								<div class="mt-0.5 text-xs opacity-50">
									{session.messageCount} msgs • {timeAgo(session.updatedAt)}
								</div>
							</div>
							<button
								class="btn opacity-0 btn-ghost btn-xs group-hover:opacity-100"
								onclick={(e) => {
									e.stopPropagation();
									onDelete(session.id);
								}}
								title="Delete session"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="h-3 w-3"
								>
									<path
										d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z"
									/>
								</svg>
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
