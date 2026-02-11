<script lang="ts">
	let uploadText = $state('');
	let sourceName = $state('');
	let uploadType = $state<'knowledge' | 'note'>('knowledge');
	let isUploading = $state(false);
	let uploadResult = $state<{ chunksStored: number; message: string } | null>(null);
	let uploadError = $state<string | null>(null);

	async function handleUpload() {
		if (!uploadText.trim()) return;

		isUploading = true;
		uploadResult = null;
		uploadError = null;

		try {
			const res = await fetch('/api/memory/upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					content: uploadText,
					source: sourceName || 'Manual upload',
					type: uploadType
				})
			});

			const data = await res.json();

			if (data.error) {
				uploadError = data.error;
			} else {
				uploadResult = data;
				uploadText = '';
				sourceName = '';
			}
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Upload failed';
		} finally {
			isUploading = false;
		}
	}
</script>

<div class="flex h-full flex-col">
	<div class="border-b border-base-300 p-4">
		<h3 class="text-sm font-medium">Upload Text to Vector Memory</h3>
		<p class="text-xs opacity-50">
			Paste text content to chunk and embed into the vector store for semantic search.
		</p>
	</div>

	<div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
		<!-- Text area -->
		<textarea
			class="textarea-bordered textarea min-h-64 w-full font-mono text-sm"
			placeholder="Paste text content here — documentation, notes, articles, etc."
			bind:value={uploadText}
		></textarea>

		<!-- Options -->
		<div class="flex flex-wrap gap-4">
			<div class="form-control flex-1">
				<label class="label" for="source-name">
					<span class="label-text text-xs">Source Name</span>
				</label>
				<input
					id="source-name"
					type="text"
					class="input-bordered input input-sm"
					placeholder="e.g., SvelteKit Docs, Meeting Notes"
					bind:value={sourceName}
				/>
			</div>
			<div class="form-control">
				<label class="label" for="upload-type">
					<span class="label-text text-xs">Type</span>
				</label>
				<select id="upload-type" class="select-bordered select select-sm" bind:value={uploadType}>
					<option value="knowledge">Knowledge</option>
					<option value="note">Note</option>
				</select>
			</div>
		</div>

		<!-- Upload button -->
		<button
			class="btn btn-primary"
			onclick={handleUpload}
			disabled={isUploading || !uploadText.trim()}
		>
			{#if isUploading}
				<span class="loading loading-sm loading-spinner"></span>
				Processing...
			{:else}
				🧠 Memorize
			{/if}
		</button>

		<!-- Result / Error -->
		{#if uploadResult}
			<div class="alert alert-success">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<span>{uploadResult.message}</span>
			</div>
		{/if}

		{#if uploadError}
			<div class="alert alert-error">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<span>{uploadError}</span>
			</div>
		{/if}

		<!-- Character count -->
		{#if uploadText.length > 0}
			<div class="text-xs opacity-40">
				{uploadText.length} characters • ~{Math.ceil(uploadText.length / 1500)} chunks
			</div>
		{/if}
	</div>
</div>
