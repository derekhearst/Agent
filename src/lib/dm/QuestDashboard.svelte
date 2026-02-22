<script lang="ts">
	interface Quest {
		id: string;
		campaignId: string;
		title: string;
		description: string;
		category: string;
		deadline: string | null;
		urgency: string;
		status: string;
		notes: string | null;
	}

	interface Props {
		quests: Quest[];
		onAdd: () => void;
		onEdit: (quest: Quest) => void;
		onStatusChange: (id: string, status: string) => Promise<void>;
	}

	let { quests, onAdd, onEdit, onStatusChange }: Props = $props();

	let activeTab = $state<'active' | 'completed' | 'failed'>('active');
	let changingId = $state<string | null>(null);
	let sortBy = $state<'urgency' | 'title' | 'deadline'>('urgency');

	const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

	async function changeStatus(id: string, status: string) {
		changingId = id;
		try {
			await onStatusChange(id, status);
		} finally {
			changingId = null;
		}
	}

	function sortQuests(list: Quest[]): Quest[] {
		return [...list].sort((a, b) => {
			if (sortBy === 'urgency')
				return (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9);
			if (sortBy === 'title') return a.title.localeCompare(b.title);
			if (sortBy === 'deadline') return (a.deadline || 'zzz').localeCompare(b.deadline || 'zzz');
			return 0;
		});
	}

	let filtered = $derived(
		quests.filter((q) => {
			if (activeTab === 'active') return q.status === 'active' || q.status === 'hidden';
			return q.status === activeTab;
		})
	);

	let deadlines = $derived(sortQuests(filtered.filter((q) => q.category === 'hard_deadline')));
	let leads = $derived(sortQuests(filtered.filter((q) => q.category === 'active_lead')));
	let rumors = $derived(sortQuests(filtered.filter((q) => q.category === 'rumor')));
	let sideQuests = $derived(sortQuests(filtered.filter((q) => q.category === 'side_quest')));

	function urgencyColor(u: string): string {
		switch (u) {
			case 'critical':
				return 'badge-error';
			case 'high':
				return 'badge-warning';
			case 'medium':
				return 'badge-info';
			default:
				return 'badge-ghost';
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Quest Dashboard</h3>
		<div class="flex items-center gap-2">
			<select class="select-bordered select select-xs" bind:value={sortBy}>
				<option value="urgency">Sort: Urgency</option>
				<option value="title">Sort: Title</option>
				<option value="deadline">Sort: Deadline</option>
			</select>
			<button class="btn btn-xs btn-primary" onclick={onAdd}>+ Quest</button>
		</div>
	</div>

	<div role="tablist" class="tabs-boxed tabs tabs-sm">
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'active'}
			onclick={() => (activeTab = 'active')}
			>Active ({quests.filter((q) => q.status === 'active').length})</button
		>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'completed'}
			onclick={() => (activeTab = 'completed')}>Completed</button
		>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'failed'}
			onclick={() => (activeTab = 'failed')}>Failed</button
		>
	</div>

	{#if filtered.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No quests in this category.</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Hard Deadlines column -->
			{#if deadlines.length > 0}
				<div>
					<h4 class="mb-2 text-xs font-semibold text-error uppercase opacity-70">
						⏰ Hard Deadlines
					</h4>
					<div class="flex flex-col gap-2">
						{#each deadlines as q (q.id)}
							<div
								class="rounded-box border border-error/30 bg-base-100 p-2 transition-colors hover:border-error/60"
							>
								<button class="w-full text-left" onclick={() => onEdit(q)}>
									<div class="flex items-center gap-2">
										<span class="badge badge-xs {urgencyColor(q.urgency)}">{q.urgency}</span>
										<span class="text-sm font-medium">{q.title}</span>
									</div>
									{#if q.deadline}
										<div class="mt-1 text-xs text-error opacity-70">Deadline: {q.deadline}</div>
									{/if}
									{#if q.description}
										<div class="mt-1 line-clamp-2 text-xs opacity-60">{q.description}</div>
									{/if}
								</button>
								<div class="mt-1 flex gap-1">
									<button
										class="btn btn-outline btn-xs btn-success"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'completed')}>✓ Done</button
									>
									<button
										class="btn btn-outline btn-xs btn-error"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'failed')}>✗ Failed</button
									>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Active Leads column -->
			{#if leads.length > 0}
				<div>
					<h4 class="mb-2 text-xs font-semibold text-info uppercase opacity-70">🔍 Active Leads</h4>
					<div class="flex flex-col gap-2">
						{#each leads as q (q.id)}
							<div
								class="rounded-box border border-base-300 bg-base-100 p-2 transition-colors hover:border-info/40"
							>
								<button class="w-full text-left" onclick={() => onEdit(q)}>
									<div class="flex items-center gap-2">
										<span class="badge badge-xs {urgencyColor(q.urgency)}">{q.urgency}</span>
										<span class="text-sm font-medium">{q.title}</span>
									</div>
									{#if q.description}
										<div class="mt-1 line-clamp-2 text-xs opacity-60">{q.description}</div>
									{/if}
								</button>
								<div class="mt-1 flex gap-1">
									<button
										class="btn btn-outline btn-xs btn-success"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'completed')}>✓ Done</button
									>
									<button
										class="btn btn-outline btn-xs btn-error"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'failed')}>✗ Failed</button
									>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Rumors & Side Quests -->
		{#if rumors.length > 0 || sideQuests.length > 0}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				{#if rumors.length > 0}
					<div>
						<h4 class="mb-2 text-xs font-semibold uppercase opacity-50">👂 Rumors</h4>
						{#each rumors as q (q.id)}
							<div
								class="mb-1 flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 p-2 text-xs hover:border-primary/30"
							>
								<button class="flex-1 text-left" onclick={() => onEdit(q)}>
									{q.title}{#if q.description}
										— <span class="opacity-60">{q.description}</span>{/if}
								</button>
								{#if activeTab === 'active'}
									<button
										class="btn btn-ghost btn-xs"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'completed')}
										title="Complete">✓</button
									>
								{:else}
									<button
										class="btn btn-ghost btn-xs"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'active')}
										title="Reactivate">↩</button
									>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
				{#if sideQuests.length > 0}
					<div>
						<h4 class="mb-2 text-xs font-semibold uppercase opacity-50">🗺️ Side Quests</h4>
						{#each sideQuests as q (q.id)}
							<div
								class="mb-1 flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 p-2 text-xs hover:border-primary/30"
							>
								<button class="flex-1 text-left" onclick={() => onEdit(q)}>
									<span class="badge badge-xs {urgencyColor(q.urgency)} mr-1">{q.urgency}</span>
									{q.title}
								</button>
								{#if activeTab === 'active'}
									<button
										class="btn btn-outline btn-xs btn-success"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'completed')}>✓</button
									>
									<button
										class="btn btn-outline btn-xs btn-error"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'failed')}>✗</button
									>
								{:else}
									<button
										class="btn btn-ghost btn-xs"
										disabled={changingId === q.id}
										onclick={() => changeStatus(q.id, 'active')}>↩ Reactivate</button
									>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
