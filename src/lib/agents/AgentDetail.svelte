<script lang="ts">
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import { getAgentById } from '$lib/agents/agents.remote';
	import { getFileContent } from '$lib/memory/memory.remote';

	interface AgentData {
		id: string;
		name: string;
		description: string;
		systemPrompt: string;
		cronSchedule: string;
		model: string;
		enabled: boolean;
		memoryPath: string;
		lastRunAt: Date | null;
		lastRunStatus: string | null;
		nextRun: string | null;
		runs: AgentRunData[];
	}

	interface AgentRunData {
		id: string;
		status: string;
		output: string;
		toolCalls: string | null;
		duration: number | null;
		startedAt: Date;
		completedAt: Date | null;
		error: string | null;
	}

	interface Props {
		agentId: string;
		onBack: () => void;
		onDelete: (id: string) => void;
		onRunNow: (id: string) => void;
		onUpdate: (id: string, data: Record<string, unknown>) => void;
	}

	let { agentId, onBack, onDelete, onRunNow, onUpdate }: Props = $props();

	let agentData = $state<AgentData | null>(null);
	let runs = $state<AgentRunData[]>([]);
	let activeTab = $state<'runs' | 'prompt' | 'memory'>('runs');
	let isEditing = $state(false);
	let editPrompt = $state('');
	let editCron = $state('');
	let editDesc = $state('');
	let expandedRunId = $state<string | null>(null);
	let memoryContent = $state('');
	let tempContent = $state('');

	// Load agent data
	$effect(() => {
		if (agentId) {
			loadAgent();
		}
	});

	async function loadAgent() {
		try {
			const data = await getAgentById(agentId);
			agentData = data;
			runs = data?.runs || [];
			editPrompt = data?.systemPrompt || '';
			editCron = data?.cronSchedule || '';
			editDesc = data?.description || '';
		} catch (err) {
			console.error('Failed to load agent:', err);
		}
	}

	async function loadMemory() {
		if (!agentData) return;
		try {
			memoryContent = await getFileContent(`${agentData.memoryPath}/memory.md`);
		} catch {
			memoryContent = '(No memory file yet)';
		}

		try {
			tempContent = await getFileContent(`${agentData.memoryPath}/temp.md`);
		} catch {
			tempContent = '(No temp file yet)';
		}
	}

	$effect(() => {
		if (activeTab === 'memory' && agentData) {
			loadMemory();
		}
	});

	async function saveEdits() {
		if (!agentData) return;
		const updateData: Record<string, unknown> = {};
		if (editPrompt !== agentData.systemPrompt) updateData.systemPrompt = editPrompt;
		if (editCron !== agentData.cronSchedule) updateData.cronSchedule = editCron;
		if (editDesc !== agentData.description) updateData.description = editDesc;

		if (Object.keys(updateData).length > 0) {
			onUpdate(agentData.id, updateData);
			isEditing = false;
			await loadAgent();
		} else {
			isEditing = false;
		}
	}

	function formatDate(dateInput: Date | string | null): string {
		if (!dateInput) return 'N/A';
		const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
		return d.toLocaleString();
	}

	function formatDuration(ms: number | null): string {
		if (!ms) return 'N/A';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

{#if agentData}
	<div class="flex h-full flex-col">
		<!-- Header -->
		<div class="flex items-center gap-3 border-b border-base-300 p-4">
			<button class="btn btn-ghost btn-sm" onclick={onBack}> ← Back </button>
			<div class="flex-1">
				<h2 class="text-lg font-bold">{agentData.name}</h2>
				<p class="text-sm opacity-60">{agentData.description}</p>
			</div>
			<div class="flex gap-2">
				<button class="btn btn-outline btn-sm" onclick={() => onRunNow(agentData!.id)}>
					▶ Run Now
				</button>
				{#if isEditing}
					<button class="btn btn-sm btn-primary" onclick={saveEdits}>Save</button>
					<button class="btn btn-ghost btn-sm" onclick={() => (isEditing = false)}> Cancel </button>
				{:else}
					<button class="btn btn-outline btn-sm" onclick={() => (isEditing = true)}> Edit </button>
				{/if}
				<button
					class="btn btn-outline btn-sm btn-error"
					onclick={() => {
						if (confirm(`Delete agent "${agentData!.name}"? This cannot be undone.`)) {
							onDelete(agentData!.id);
						}
					}}
				>
					Delete
				</button>
			</div>
		</div>

		<!-- Info bar -->
		<div class="flex flex-wrap items-center gap-4 border-b border-base-300 px-4 py-2 text-sm">
			<span class="flex items-center gap-1 opacity-60">
				<span class="font-medium">Schedule:</span>
				{#if isEditing}
					<input
						type="text"
						class="input-bordered input input-xs w-36 font-mono"
						bind:value={editCron}
					/>
				{:else}
					<code class="rounded bg-base-300 px-1">{agentData.cronSchedule}</code>
				{/if}
			</span>
			<span class="opacity-60">
				<span class="font-medium">Model:</span>
				{agentData.model}
			</span>
			<span class="opacity-60">
				<span class="font-medium">Next run:</span>
				{formatDate(agentData.nextRun)}
			</span>
			<span class="opacity-60">
				<span class="font-medium">Memory:</span>
				{agentData.memoryPath}/
			</span>
		</div>

		<!-- Tabs -->
		<div class="tabs-bordered tabs px-4">
			<button
				class="tab"
				class:tab-active={activeTab === 'runs'}
				onclick={() => (activeTab = 'runs')}
			>
				Run Log ({runs.length})
			</button>
			<button
				class="tab"
				class:tab-active={activeTab === 'prompt'}
				onclick={() => (activeTab = 'prompt')}
			>
				System Prompt
			</button>
			<button
				class="tab"
				class:tab-active={activeTab === 'memory'}
				onclick={() => (activeTab = 'memory')}
			>
				Memory Files
			</button>
		</div>

		<!-- Tab content -->
		<div class="flex-1 overflow-y-auto p-4">
			{#if activeTab === 'runs'}
				{#if runs.length === 0}
					<p class="py-8 text-center opacity-40">
						No runs yet. Click "Run Now" to trigger the first execution.
					</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each runs as run (run.id)}
							<div
								class="collapse-arrow collapse border border-base-300 bg-base-200"
								class:collapse-open={expandedRunId === run.id}
							>
								<div
									class="collapse-title flex items-center gap-3 text-sm font-medium"
									role="button"
									tabindex="0"
									onclick={() => (expandedRunId = expandedRunId === run.id ? null : run.id)}
									onkeydown={(e) =>
										e.key === 'Enter' && (expandedRunId = expandedRunId === run.id ? null : run.id)}
								>
									<span
										class="badge badge-sm"
										class:badge-success={run.status === 'success'}
										class:badge-error={run.status === 'error'}
										class:badge-warning={run.status === 'running'}
									>
										{run.status}
									</span>
									<span>{formatDate(run.startedAt)}</span>
									<span class="opacity-50">{formatDuration(run.duration)}</span>
									{#if run.toolCalls}
										{@const toolCount = JSON.parse(run.toolCalls).length}
										<span class="opacity-50">{toolCount} tool call{toolCount !== 1 ? 's' : ''}</span
										>
									{/if}
								</div>
								<div class="collapse-content">
									{#if run.error}
										<div class="mb-3 alert text-sm alert-error">
											{run.error}
										</div>
									{/if}
									{#if run.output}
										<div class="prose-sm prose max-w-none">
											<MarkdownRenderer content={run.output} />
										</div>
									{:else}
										<p class="opacity-40">No output</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if activeTab === 'prompt'}
				{#if isEditing}
					<div>
						<label class="label text-sm font-medium" for="edit-desc">Description</label>
						<input
							id="edit-desc"
							type="text"
							class="input-bordered input w-full"
							bind:value={editDesc}
						/>
						<label class="label mt-3 text-sm font-medium" for="edit-prompt">System Prompt</label>
						<textarea
							id="edit-prompt"
							class="textarea-bordered textarea w-full font-mono text-xs"
							rows={20}
							bind:value={editPrompt}
						></textarea>
					</div>
				{:else}
					<div class="prose-sm prose max-w-none">
						<pre
							class="rounded-lg bg-base-300 p-4 text-xs whitespace-pre-wrap">{agentData.systemPrompt}</pre>
					</div>
				{/if}
			{:else if activeTab === 'memory'}
				<div class="flex flex-col gap-4">
					<div>
						<h4 class="mb-2 font-semibold">memory.md (Persistent)</h4>
						<div class="rounded-lg bg-base-300 p-4">
							{#if memoryContent}
								<pre class="text-sm whitespace-pre-wrap">{memoryContent}</pre>
							{:else}
								<p class="opacity-40">No memory file yet</p>
							{/if}
						</div>
					</div>
					<div>
						<h4 class="mb-2 font-semibold">temp.md (Latest Run)</h4>
						<div class="rounded-lg bg-base-300 p-4">
							{#if tempContent}
								<pre class="text-sm whitespace-pre-wrap">{tempContent}</pre>
							{:else}
								<p class="opacity-40">No temp file yet</p>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="flex h-full items-center justify-center">
		<span class="loading loading-lg loading-spinner"></span>
	</div>
{/if}
