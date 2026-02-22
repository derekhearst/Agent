<script lang="ts">
	import { Pop } from '$lib/dm/pop';

	interface Props {
		campaignId: string;
		sources: Array<{
			id: string;
			title: string;
			type: string;
			content: string;
			createdAt: Date | string;
		}>;
		onAdd: (data: {
			campaignId: string;
			title: string;
			type: string;
			content: string;
		}) => Promise<void>;
		onDelete: (id: string) => Promise<void>;
	}

	let { campaignId, sources, onAdd, onDelete }: Props = $props();

	let showAdd = $state(false);
	let title = $state('');
	let type = $state<'rulebook' | 'module' | 'homebrew' | 'notes'>('rulebook');
	let content = $state('');
	let isSubmitting = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let previewSource = $state<{ id: string; title: string; type: string; content: string } | null>(
		null
	);

	// Chapter-by-chapter mode
	let chapterMode = $state(false);
	let baseTitle = $state('');
	let chapterNum = $state(1);
	let chaptersAdded = $state(0);

	function startChapterMode() {
		chapterMode = true;
		baseTitle = '';
		chapterNum = 1;
		chaptersAdded = 0;
		title = '';
		content = '';
		showAdd = true;
	}

	function updateChapterTitle() {
		if (chapterMode && baseTitle.trim()) {
			title = `${baseTitle.trim()} - Ch ${chapterNum}`;
		}
	}

	async function handleAdd() {
		if (!title.trim() || !content.trim()) return;
		isSubmitting = true;
		try {
			await onAdd({ campaignId, title: title.trim(), type, content: content.trim() });
			if (chapterMode) {
				chaptersAdded++;
				chapterNum++;
				content = '';
				updateChapterTitle();
				Pop.success(`Chapter ${chapterNum - 1} added! Paste the next chapter.`);
				if (fileInput) fileInput.value = '';
			} else {
				Pop.success('Source book added & vectorized');
				showAdd = false;
				title = '';
				content = '';
			}
		} catch (err) {
			Pop.error('Failed to add source');
			console.error(err);
		} finally {
			isSubmitting = false;
		}
	}

	async function handleFileUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			content = text;
			if (!title.trim()) {
				title = file.name.replace(/\.[^.]+$/, '');
			}
		} catch {
			Pop.error('Failed to read file');
		}
	}

	async function handleDelete(id: string) {
		const confirmed = await Pop.confirm(
			'Delete this source book? Vector embeddings will also be removed.'
		);
		if (!confirmed) return;
		try {
			await onDelete(id);
			Pop.success('Source deleted');
		} catch {
			Pop.error('Delete failed');
		}
	}

	function truncate(s: string, max = 120): string {
		return s.length > max ? s.slice(0, max) + '...' : s;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Source Books ({sources.length})</h3>
		<div class="flex gap-1">
			{#if !showAdd}
				<button class="btn btn-outline btn-xs" onclick={startChapterMode}>
					📖 Add Book (Chapter by Chapter)
				</button>
				<button
					class="btn btn-xs btn-primary"
					onclick={() => {
						chapterMode = false;
						showAdd = true;
					}}
				>
					+ Add Source
				</button>
			{:else}
				<button
					class="btn btn-ghost btn-xs"
					onclick={() => {
						showAdd = false;
						chapterMode = false;
					}}>Cancel</button
				>
			{/if}
		</div>
	</div>

	{#if showAdd}
		<div class="rounded-box border border-base-300 bg-base-100 p-4">
			{#if chapterMode}
				<!-- Chapter-by-chapter banner -->
				<div class="mb-3 rounded-lg border border-info/30 bg-info/10 p-2 text-xs">
					📖 <strong>Chapter Mode</strong> — Paste one chapter at a time. The form stays open after
					each add.
					{#if chaptersAdded > 0}
						<span class="ml-1 badge badge-xs badge-success">{chaptersAdded} added</span>
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-3">
				{#if chapterMode}
					<div class="flex gap-2">
						<input
							type="text"
							class="input-bordered input input-sm flex-1"
							placeholder="Book title (e.g. Player's Handbook)"
							bind:value={baseTitle}
							oninput={updateChapterTitle}
						/>
						<input
							type="number"
							class="input-bordered input input-sm w-20"
							min="1"
							bind:value={chapterNum}
							oninput={updateChapterTitle}
							placeholder="Ch #"
						/>
						<select class="select-bordered select select-sm" bind:value={type}>
							<option value="rulebook">Rulebook</option>
							<option value="module">Module</option>
							<option value="homebrew">Homebrew</option>
							<option value="notes">Notes</option>
						</select>
					</div>
					<div class="text-xs opacity-50">
						Will be saved as: <strong>{title || '(enter book title)'}</strong>
					</div>
				{:else}
					<div class="flex gap-2">
						<input
							type="text"
							class="input-bordered input input-sm flex-1"
							placeholder="Title (e.g. Player's Handbook)"
							bind:value={title}
						/>
						<select class="select-bordered select select-sm" bind:value={type}>
							<option value="rulebook">Rulebook</option>
							<option value="module">Module</option>
							<option value="homebrew">Homebrew</option>
							<option value="notes">Notes</option>
						</select>
					</div>
				{/if}

				<div class="flex gap-2">
					<input
						type="file"
						accept=".txt,.md,.json"
						class="file-input-bordered file-input flex-1 file-input-sm"
						bind:this={fileInput}
						onchange={handleFileUpload}
					/>
				</div>

				<textarea
					class="textarea-bordered textarea min-h-40 text-sm"
					placeholder={chapterMode
						? `Paste Chapter ${chapterNum} content here...`
						: 'Paste or upload content here...'}
					bind:value={content}
				></textarea>

				<div class="flex items-center justify-between">
					{#if chapterMode && chaptersAdded > 0}
						<button
							class="btn btn-ghost btn-sm"
							onclick={() => {
								showAdd = false;
								chapterMode = false;
							}}
						>
							✓ Done Adding Chapters
						</button>
					{:else}
						<div></div>
					{/if}
					<button
						class="btn btn-sm btn-primary"
						disabled={!title.trim() || !content.trim() || isSubmitting}
						onclick={handleAdd}
					>
						{isSubmitting
							? 'Vectorizing...'
							: chapterMode
								? `Add Ch ${chapterNum} & Continue`
								: 'Add & Vectorize'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if sources.length === 0}
		<p class="py-4 text-center text-sm opacity-50">
			No source books yet. Add D&D 5e rulebooks, modules, or homebrew content.
		</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each sources as source (source.id)}
				<div
					class="flex items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2"
				>
					<button
						class="flex min-w-0 flex-1 items-center gap-3 text-left"
						onclick={() => (previewSource = source)}
					>
						<div class="text-lg">
							{#if source.type === 'rulebook'}📕{:else if source.type === 'module'}📗{:else if source.type === 'homebrew'}📙{:else}📝{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{source.title}</div>
							<div class="text-xs opacity-50">{truncate(source.content)}</div>
						</div>
					</button>
					<span class="badge badge-ghost badge-xs capitalize">{source.type}</span>
					<button class="btn text-error btn-ghost btn-xs" onclick={() => handleDelete(source.id)}
						>✕</button
					>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Source Preview Modal -->
{#if previewSource}
	<div class="modal-open modal">
		<div class="modal-box max-h-[80vh] max-w-3xl">
			<div class="mb-3 flex items-center justify-between">
				<h3 class="text-lg font-semibold">{previewSource.title}</h3>
				<span class="badge badge-ghost capitalize">{previewSource.type}</span>
			</div>
			<div class="max-h-[60vh] overflow-y-auto rounded-box bg-base-200 p-4">
				<pre class="font-mono text-sm whitespace-pre-wrap">{previewSource.content}</pre>
			</div>
			<div class="modal-action">
				<button class="btn btn-sm" onclick={() => (previewSource = null)}>Close</button>
			</div>
		</div>
		<button class="modal-backdrop" onclick={() => (previewSource = null)} aria-label="Close preview"
		></button>
	</div>
{/if}
