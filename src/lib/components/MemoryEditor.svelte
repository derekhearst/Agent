<script lang="ts">
	import MarkdownRenderer from './MarkdownRenderer.svelte';

	interface Props {
		filePath: string;
		content: string;
		isDirty: boolean;
		onSave: (content: string) => void;
		onDelete: () => void;
	}

	let { filePath, content = $bindable(), isDirty, onSave, onDelete }: Props = $props();

	let showPreview = $state(false);
	let isSaving = $state(false);

	async function handleSave() {
		isSaving = true;
		try {
			onSave(content);
		} finally {
			isSaving = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			handleSave();
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	<div class="flex items-center justify-between border-b border-base-300 px-4 py-2">
		<div class="flex items-center gap-2">
			<span class="text-xs opacity-50">{filePath}</span>
			{#if isDirty}
				<span class="badge badge-xs badge-warning">Unsaved</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2">
				<span class="text-xs opacity-60">Preview</span>
				<input type="checkbox" class="toggle toggle-xs" bind:checked={showPreview} />
			</label>
			<button class="btn btn-outline btn-xs btn-error" onclick={onDelete}> Delete </button>
			<button class="btn btn-xs btn-primary" onclick={handleSave} disabled={!isDirty || isSaving}>
				{isSaving ? 'Saving...' : 'Save'}
			</button>
		</div>
	</div>

	<!-- Editor / Preview -->
	<div class="flex-1 overflow-y-auto">
		{#if showPreview}
			<div class="p-6">
				<MarkdownRenderer {content} />
			</div>
		{:else}
			<textarea
				class="h-full w-full resize-none border-none bg-transparent p-4 font-mono text-sm focus:outline-none"
				bind:value={content}
				onkeydown={handleKeydown}
				spellcheck="true"
			></textarea>
		{/if}
	</div>
</div>
