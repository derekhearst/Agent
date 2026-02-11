<script lang="ts">
	import NavMenu from '$lib/components/NavMenu.svelte';
	import AgentCard from '$lib/agents/AgentCard.svelte';
	import AgentDetail from '$lib/agents/AgentDetail.svelte';
	import AgentSetupModal from '$lib/agents/AgentSetupModal.svelte';
	import {
		getAgents,
		createAgent as createAgentRemote,
		updateAgent as updateAgentRemote,
		deleteAgent as deleteAgentRemote,
		runAgentNow as runAgentNowRemote
	} from '$lib/agents/agents.remote';

	interface AgentData {
		id: string;
		name: string;
		description: string;
		cronSchedule: string;
		model: string;
		enabled: boolean;
		lastRunAt: Date | null;
		lastRunStatus: string | null;
		nextRun: string | null;
		isScheduled: boolean;
		lastRun: {
			id: string;
			status: string;
			output: string;
			duration: number | null;
			startedAt: Date;
		} | null;
	}

	let agents = $state<AgentData[]>([]);
	let selectedAgentId = $state<string | null>(null);
	let setupOpen = $state(false);
	let isLoading = $state(true);

	// Load agents on mount
	$effect(() => {
		loadAgents();
	});

	// Poll for updates every 30s
	$effect(() => {
		const interval = setInterval(loadAgents, 30000);
		return () => clearInterval(interval);
	});

	async function loadAgents() {
		try {
			agents = await getAgents();
		} catch (error) {
			console.error('Failed to load agents:', error);
		} finally {
			isLoading = false;
		}
	}

	async function toggleAgent(id: string, enabled: boolean) {
		try {
			await updateAgentRemote({ id, enabled });
			await loadAgents();
		} catch (error) {
			console.error('Failed to toggle agent:', error);
		}
	}

	async function runAgentNow(id: string) {
		try {
			await runAgentNowRemote(id);
			// Update the local state to show running
			agents = agents.map((a) => (a.id === id ? { ...a, lastRunStatus: 'running' } : a));
			// Poll more frequently for a bit
			setTimeout(loadAgents, 5000);
			setTimeout(loadAgents, 15000);
			setTimeout(loadAgents, 30000);
		} catch (error) {
			console.error('Failed to run agent:', error);
		}
	}

	async function createAgent(config: {
		name: string;
		description: string;
		systemPrompt: string;
		cronSchedule: string;
		model: string;
	}) {
		try {
			await createAgentRemote(config);
			setupOpen = false;
			await loadAgents();
		} catch (error) {
			console.error('Failed to create agent:', error);
			alert(error instanceof Error ? error.message : 'Failed to create agent');
		}
	}

	async function deleteAgent(id: string) {
		try {
			await deleteAgentRemote(id);
			selectedAgentId = null;
			await loadAgents();
		} catch (error) {
			console.error('Failed to delete agent:', error);
		}
	}

	async function updateAgent(id: string, data: Record<string, unknown>) {
		try {
			await updateAgentRemote({ id, ...data });
			await loadAgents();
		} catch (error) {
			console.error('Failed to update agent:', error);
		}
	}

	let enabledCount = $derived(agents.filter((a) => a.enabled).length);
	let runningCount = $derived(agents.filter((a) => a.lastRunStatus === 'running').length);
</script>

<div class="flex h-screen">
	<!-- Left sidebar: Navigation -->
	<div class="w-56 shrink-0">
		<NavMenu currentRoute="/agents" />
	</div>

	<!-- Main content -->
	<div class="flex min-w-0 flex-1 flex-col">
		{#if selectedAgentId}
			<AgentDetail
				agentId={selectedAgentId}
				onBack={() => (selectedAgentId = null)}
				onDelete={deleteAgent}
				onRunNow={runAgentNow}
				onUpdate={updateAgent}
			/>
		{:else}
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<div>
					<h1 class="text-lg font-semibold">Agents</h1>
					<p class="text-sm opacity-50">
						{agents.length} agent{agents.length !== 1 ? 's' : ''}
						{#if enabledCount > 0}
							· {enabledCount} active
						{/if}
						{#if runningCount > 0}
							· <span class="text-warning">{runningCount} running</span>
						{/if}
					</p>
				</div>
				<button class="btn btn-sm btn-primary" onclick={() => (setupOpen = true)}>
					+ New Agent
				</button>
			</div>

			<!-- Agent grid -->
			<div class="flex-1 overflow-y-auto p-4">
				{#if isLoading}
					<div class="flex items-center justify-center py-20">
						<span class="loading loading-lg loading-spinner"></span>
					</div>
				{:else if agents.length === 0}
					<div class="flex flex-col items-center justify-center py-20 text-center">
						<div class="mb-4 text-5xl opacity-20">🤖</div>
						<h3 class="text-lg font-semibold opacity-60">No agents yet</h3>
						<p class="mb-6 text-sm opacity-40">
							Create your first scheduled AI agent to automate tasks.
						</p>
						<button class="btn btn-primary" onclick={() => (setupOpen = true)}>
							+ Create Agent
						</button>
					</div>
				{:else}
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
						{#each agents as agent (agent.id)}
							<AgentCard
								{agent}
								onSelect={(id) => (selectedAgentId = id)}
								onToggle={toggleAgent}
								onRunNow={runAgentNow}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<AgentSetupModal bind:open={setupOpen} onClose={() => (setupOpen = false)} onCreate={createAgent} />
