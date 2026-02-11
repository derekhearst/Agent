<script lang="ts">
	interface Props {
		open: boolean;
		onClose: () => void;
		onImport: (url: string) => void;
	}

	let { open = $bindable(false), onClose, onImport }: Props = $props();

	let url = $state('');
	let isImporting = $state(false);
	let error = $state('');

	function handleSubmit() {
		error = '';
		const trimmed = url.trim();

		if (!trimmed) {
			error = 'Please enter a URL';
			return;
		}

		try {
			new URL(trimmed);
		} catch {
			error = 'Please enter a valid URL';
			return;
		}

		isImporting = true;
		onImport(trimmed);

		// Reset after a short delay
		setTimeout(() => {
			url = '';
			isImporting = false;
			open = false;
			onClose();
		}, 1000);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			open = false;
			onClose();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && ((open = false), onClose())}
	>
		<div
			class="w-full max-w-lg animate-[slideUp_0.2s_ease-out] rounded-2xl bg-base-100 p-6 shadow-2xl"
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-lg">
					🔗
				</div>
				<div>
					<h3 class="text-lg font-bold">Import Recipe from URL</h3>
					<p class="text-sm opacity-50">Paste a recipe link and the agent will extract it</p>
				</div>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
			>
				<div class="form-control">
					<input
						type="url"
						placeholder="https://www.americastestkitchen.com/recipes/..."
						class="input-bordered input w-full"
						class:input-error={!!error}
						bind:value={url}
						disabled={isImporting}
					/>
					{#if error}
						<label class="label">
							<span class="label-text-alt text-error">{error}</span>
						</label>
					{/if}
				</div>

				<div class="mt-2 rounded-lg bg-base-200/50 p-3 text-xs opacity-50">
					<p>
						Supported sources: Any recipe website, America's Test Kitchen, AllRecipes, Serious Eats,
						etc.
					</p>
					<p class="mt-1">
						The recipe will be sent to the Meal Planner agent via chat. You can also paste URLs
						directly in the main chat with <code class="rounded bg-base-300 px-1"
							>@meal-planner</code
						>.
					</p>
				</div>

				<div class="mt-4 flex justify-end gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onclick={() => {
							open = false;
							onClose();
						}}
					>
						Cancel
					</button>
					<button type="submit" class="btn btn-sm btn-primary" disabled={isImporting}>
						{#if isImporting}
							<span class="loading loading-xs loading-spinner"></span>
							Sending to agent...
						{:else}
							Import Recipe
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
