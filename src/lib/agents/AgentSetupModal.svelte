<script lang="ts">
	import { generateAgentConfig } from '$lib/agents/agents.remote';
	import ModelSelector from '$lib/models/ModelSelector.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onCreate: (config: AgentSetupConfig) => void;
	}

	interface AgentSetupConfig {
		name: string;
		description: string;
		systemPrompt: string;
		cronSchedule: string;
		cronHuman: string;
		model: string;
	}

	let { open = $bindable(false), onClose, onCreate }: Props = $props();

	let step = $state<'describe' | 'review'>('describe');
	let userDescription = $state('');
	let isGenerating = $state(false);
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let generatedConfig = $state<AgentSetupConfig | null>(null);
	let error = $state('');

	// Editable fields (populated from AI generation)
	let editName = $state('');
	let editDescription = $state('');
	let editPrompt = $state('');
	let editCron = $state('');
	let editCronHuman = $state('');
	let editModel = $state('moonshotai/kimi-k2.5');

	function reset() {
		step = 'describe';
		userDescription = '';
		isGenerating = false;
		generatedConfig = null;
		error = '';
		editName = '';
		editDescription = '';
		editPrompt = '';
		editCron = '';
		editCronHuman = '';
		editModel = 'moonshotai/kimi-k2.5';
	}

	function handleClose() {
		reset();
		onClose();
	}

	async function generateConfig() {
		if (!userDescription.trim()) return;

		isGenerating = true;
		error = '';

		try {
			const config = await generateAgentConfig({ description: userDescription });
			generatedConfig = config;

			// Populate edit fields
			editName = config.name || '';
			editDescription = config.description || '';
			editPrompt = config.systemPrompt || '';
			editCron = config.cronSchedule || '';
			editCronHuman = config.cronHuman || '';
			editModel = config.model || 'moonshotai/kimi-k2.5';

			step = 'review';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Generation failed';
		} finally {
			isGenerating = false;
		}
	}

	function handleCreate() {
		if (!editName.trim() || !editPrompt.trim() || !editCron.trim()) {
			error = 'Name, prompt, and schedule are required';
			return;
		}

		onCreate({
			name: editName.trim(),
			description: editDescription.trim(),
			systemPrompt: editPrompt.trim(),
			cronSchedule: editCron.trim(),
			cronHuman: editCronHuman.trim(),
			model: editModel
		});

		reset();
	}
</script>

{#if open}
	<div class="modal-open modal">
		<div class="modal-box max-w-2xl">
			<button class="btn absolute top-4 right-4 btn-circle btn-ghost btn-sm" onclick={handleClose}>
				✕
			</button>

			{#if step === 'describe'}
				<h3 class="text-lg font-bold">Create New Agent</h3>
				<p class="mt-1 text-sm opacity-60">
					Describe what you want this agent to do. AI will generate the configuration for you.
				</p>

				<div class="mt-4">
					<textarea
						class="textarea-bordered textarea w-full"
						rows={4}
						placeholder="e.g., Monitor tech news about AI and LLMs, summarize key developments daily. Focus on new model releases, benchmarks, and research papers."
						bind:value={userDescription}
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
								generateConfig();
							}
						}}
					></textarea>
				</div>

				{#if error}
					<div class="mt-3 alert text-sm alert-error">{error}</div>
				{/if}

				<div class="modal-action">
					<button class="btn btn-ghost" onclick={handleClose}>Cancel</button>
					<button
						class="btn btn-primary"
						disabled={!userDescription.trim() || isGenerating}
						onclick={generateConfig}
					>
						{#if isGenerating}
							<span class="loading loading-sm loading-spinner"></span>
							Generating...
						{:else}
							Generate Config
						{/if}
					</button>
				</div>
			{:else if step === 'review'}
				<h3 class="text-lg font-bold">Review Agent Configuration</h3>
				<p class="mt-1 text-sm opacity-60">
					Review and edit the AI-generated configuration before creating the agent.
				</p>

				<div class="mt-4 flex flex-col gap-3">
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="label text-sm font-medium" for="agent-name">Name</label>
							<input
								id="agent-name"
								type="text"
								class="input-bordered input input-sm w-full"
								bind:value={editName}
								placeholder="my-agent"
							/>
						</div>
						<div>
							<label class="label text-sm font-medium">Model</label>
							<ModelSelector currentModel={editModel} onModelChange={(m) => editModel = m} />
						</div>
					</div>

					<div>
						<label class="label text-sm font-medium" for="agent-desc">Description</label>
						<input
							id="agent-desc"
							type="text"
							class="input-bordered input input-sm w-full"
							bind:value={editDescription}
						/>
					</div>

					<div>
						<label class="label text-sm font-medium" for="agent-cron">
							Schedule
							{#if editCronHuman}
								<span class="ml-2 font-normal opacity-50">({editCronHuman})</span>
							{/if}
						</label>
						<input
							id="agent-cron"
							type="text"
							class="input-bordered input input-sm w-full font-mono"
							bind:value={editCron}
							placeholder="0 9 * * *"
						/>
					</div>

					<div>
						<label class="label text-sm font-medium" for="agent-prompt">System Prompt</label>
						<textarea
							id="agent-prompt"
							class="textarea-bordered textarea w-full font-mono text-xs"
							rows={10}
							bind:value={editPrompt}
						></textarea>
					</div>
				</div>

				{#if error}
					<div class="mt-3 alert text-sm alert-error">{error}</div>
				{/if}

				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => (step = 'describe')}>← Back</button>
					<button class="btn btn-primary" onclick={handleCreate}> Create Agent </button>
				</div>
			{/if}
		</div>
		<div class="modal-backdrop" role="presentation" onclick={handleClose}></div>
	</div>
{/if}
