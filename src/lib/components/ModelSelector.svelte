<script lang="ts">
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
	let isOpen = $state(false);
	let isLoading = $state(false);
	let dropdownRef: HTMLDivElement | undefined = $state();

	// Fetch models on mount
	$effect(() => {
		fetchModels();
	});

	// Close dropdown on outside click
	$effect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
				isOpen = false;
			}
		}
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	async function fetchModels() {
		isLoading = true;
		try {
			const res = await fetch('/api/models');
			if (res.ok) {
				models = await res.json();
			}
		} catch (e) {
			console.error('Failed to fetch models:', e);
		} finally {
			isLoading = false;
		}
	}

	let filteredModels = $derived.by(() => {
		if (!search.trim()) return models.slice(0, 50); // Show top 50 by default
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
		isOpen = false;
		search = '';
	}

	function formatPrice(price: string): string {
		const num = parseFloat(price);
		if (num === 0) return 'Free';
		// Price is per token, show per 1M tokens
		const perMillion = num * 1_000_000;
		if (perMillion < 0.01) return '<$0.01/M';
		return `$${perMillion.toFixed(2)}/M`;
	}

	function getProvider(modelId: string): string {
		return modelId.split('/')[0] || '';
	}
</script>

<div class="relative" bind:this={dropdownRef}>
	<button
		type="button"
		class="btn gap-1 font-normal btn-ghost btn-xs"
		onclick={() => (isOpen = !isOpen)}
		title="Select model"
	>
		<span class="max-w-48 truncate text-xs">{selectedModelName}</span>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3">
			<path
				fill-rule="evenodd"
				d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if isOpen}
		<div
			class="absolute top-full right-0 z-50 mt-1 w-96 rounded-lg border border-base-300 bg-base-200 shadow-xl"
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
			<div class="border-b border-base-300">
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-300"
					class:bg-primary={currentModel === 'openrouter/auto'}
					class:text-primary-content={currentModel === 'openrouter/auto'}
					onclick={() => selectModel('openrouter/auto')}
				>
					<div class="flex-1">
						<div class="font-medium">Auto</div>
						<div class="text-xs opacity-60">Automatic model selection — Free</div>
					</div>
					<span class="badge badge-xs badge-success">Free</span>
				</button>
			</div>

			<!-- Model list -->
			<div class="max-h-72 overflow-y-auto">
				{#if isLoading}
					<div class="flex items-center justify-center p-4">
						<span class="loading loading-sm loading-spinner"></span>
					</div>
				{:else if filteredModels.length === 0}
					<div class="p-4 text-center text-sm opacity-50">No models found</div>
				{:else}
					{#each filteredModels as model (model.id)}
						<button
							type="button"
							class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-300"
							class:bg-primary={model.id === currentModel}
							class:text-primary-content={model.id === currentModel}
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
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
