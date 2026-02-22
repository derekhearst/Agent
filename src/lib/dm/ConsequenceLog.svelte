<script lang="ts">
	interface Consequence {
		id: string;
		action: string;
		results: string;
		sessionId: string | null;
		createdAt: Date | string;
	}

	interface Props {
		consequences: Consequence[];
		onResolve: (id: string, resultIndex: number) => Promise<void>;
		onDelete: (id: string) => Promise<void>;
	}

	let { consequences, onResolve, onDelete }: Props = $props();

	let expandedId = $state<string | null>(null);

	interface ParsedResult {
		description: string;
		affectedEntity?: string;
		resolved?: boolean;
	}

	function parseResults(resultsJson: string): ParsedResult[] {
		try {
			return JSON.parse(resultsJson) as ParsedResult[];
		} catch {
			return [];
		}
	}

	function hasUnresolved(c: Consequence): boolean {
		const results = parseResults(c.results);
		return results.some((r) => !r.resolved);
	}

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="flex flex-col gap-3">
	<h3 class="text-sm font-semibold">
		Butterfly Effect Log ({consequences.filter(hasUnresolved).length} unresolved)
	</h3>

	{#if consequences.length === 0}
		<p class="py-4 text-center text-sm opacity-50">
			No consequences logged. The AI will auto-log consequences during sessions.
		</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each consequences as c (c.id)}
				{@const results = parseResults(c.results)}
				{@const unresolved = results.filter((r) => !r.resolved)}
				<div
					class="rounded-box border border-base-300 bg-base-100 p-3 transition-colors"
					class:border-warning={unresolved.length > 0}
				>
					<div class="flex items-start justify-between">
						<button
							class="text-left text-sm font-medium"
							onclick={() => (expandedId = expandedId === c.id ? null : c.id)}
						>
							<span class="mr-1">{unresolved.length > 0 ? '🦋' : '✅'}</span>
							{c.action}
						</button>
						<span class="text-xs opacity-40">{formatDate(c.createdAt)}</span>
					</div>

					{#if expandedId === c.id}
						<div class="mt-2 flex flex-col gap-1">
							{#each results as result, idx (idx)}
								<div class="flex items-start gap-2 text-xs" class:opacity-40={result.resolved}>
									<button
										class="mt-0.5 shrink-0"
										onclick={() => onResolve(c.id, idx)}
										title={result.resolved ? 'Already resolved' : 'Mark resolved'}
									>
										{result.resolved ? '☑' : '☐'}
									</button>
									<div>
										<span>{result.description}</span>
										{#if result.affectedEntity}
											<span class="ml-1 badge badge-ghost badge-xs">{result.affectedEntity}</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
						<div class="mt-2 flex justify-end">
							<button class="btn text-error btn-ghost btn-xs" onclick={() => onDelete(c.id)}
								>Delete</button
							>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
