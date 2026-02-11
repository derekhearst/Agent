<script lang="ts">
	import { getModels } from '$lib/models/models.remote';

	interface Props {
		currentModel: string;
		onModelChange: (model: string) => void;
	}

	let { currentModel, onModelChange }: Props = $props();

	interface ModelInfo {
		id: string;
		name: string;
		context_length: number;
		input_modalities: string[];
		output_modalities: string[];
		pricing: { prompt: string; completion: string };
		supported_parameters: string[];
		isFree: boolean;
	}

	let models = $state<ModelInfo[]>([]);
	let search = $state('');
	let isLoading = $state(false);

	// Fetch models on mount
	$effect(() => {
		fetchModels();
	});

	async function fetchModels() {
		isLoading = true;
		try {
			models = await getModels({});
		} catch (e) {
			console.error('Failed to fetch models:', e);
		} finally {
			isLoading = false;
		}
	}

	let filteredModels = $derived.by(() => {
		if (!search.trim()) return models.slice(0, 50);
		const q = search.toLowerCase();
		return models
			.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
			.slice(0, 50);
	});

	let selectedModelName = $derived.by(() => {
		if (currentModel === 'openrouter/auto') return 'Auto (Free)';
		const found = models.find((m) => m.id === currentModel);
		return found?.name || currentModel;
	});

	function selectModel(id: string) {
		onModelChange(id);
		search = '';
		// Close dropdown by removing focus
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}

	function formatPrice(price: string): string {
		const num = parseFloat(price);
		if (num === 0) return 'Free';
		const perMillion = num * 1_000_000;
		if (perMillion < 0.01) return '<$0.01/M';
		return `$${perMillion.toFixed(2)}/M`;
	}

	function getProvider(modelId: string): string {
		return modelId.split('/')[0] || '';
	}
</script>

<!-- DaisyUI CSS focus-based dropdown -->
<div class="dropdown dropdown-end">
	<div tabindex="0" role="button" class="btn gap-1 font-normal btn-ghost btn-xs">
		<span class="max-w-48 truncate text-xs">{selectedModelName}</span>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3">
			<path
				fill-rule="evenodd"
				d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"
				clip-rule="evenodd"
			/>
		</svg>
	</div>
	<div
		class="dropdown-content menu
		 mt-1 w-96 rounded-lg border border-base-300 bg-base-200 p-0 shadow-xl"
	>
		<!-- Search -->
		<div class="border-b border-base-300 p-2">
			<input
				type="text"
				bind:value={search}
				placeholder="Search models..."
				class="input-bordered input input-sm w-full"
			/>
		</div>

		<!-- Auto option -->
		<ul class="border-b border-base-300">
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-sm"
					class:active={currentModel === 'openrouter/auto'}
					onclick={() => selectModel('openrouter/auto')}
				>
					<div class="flex-1">
						<div class="font-medium">Auto</div>
						<div class="text-xs opacity-60">Automatic model selection — Free</div>
					</div>
					<span class="badge badge-xs badge-success">Free</span>
				</button>
			</li>
		</ul>

		<!-- Model list -->
		<ul class="max-h-72 overflow-y-auto">
			{#if isLoading}
				<li class="flex items-center justify-center p-4">
					<span class="loading loading-sm loading-spinner"></span>
				</li>
			{:else if filteredModels.length === 0}
				<li class="p-4 text-center text-sm opacity-50">No models found</li>
			{:else}
				{#each filteredModels as model (model.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-none px-3 py-1.5 text-left text-sm"
							class:active={model.id === currentModel}
							onclick={() => selectModel(model.id)}
						>
							<div class="min-w-0 flex-1">
								<div class="truncate text-xs font-medium">{model.name}</div>
								<div class="flex items-center gap-2 text-xs opacity-50">
									<span>{getProvider(model.id)}</span>
									<span>•</span>
									<span>{Math.round(model.context_length / 1000)}k ctx</span>
									{#if model.input_modalities.includes('image')}
										<span title="Supports image input">🖼️</span>
									{/if}
									{#if model.supported_parameters.includes('tools')}
										<span title="Supports tool calling">🔧</span>
									{/if}
								</div>
							</div>
							<div class="shrink-0 text-right">
								{#if model.isFree}
									<span class="badge badge-xs badge-success">Free</span>
								{:else}
									<div class="text-xs opacity-50">{formatPrice(model.pricing.prompt)}</div>
								{/if}
							</div>
						</button>
					</li>
				{/each}
			{/if}
		</ul>
	</div>
</div>
