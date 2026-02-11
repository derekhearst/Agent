<script lang="ts">
	import NavMenu from '$lib/components/NavMenu.svelte';
	import MemoryFileTree from '$lib/components/MemoryFileTree.svelte';
	import MemoryEditor from '$lib/components/MemoryEditor.svelte';
	import VectorSearch from '$lib/components/VectorSearch.svelte';
	import VectorUpload from '$lib/components/VectorUpload.svelte';

	interface FileNode {
		name: string;
		path: string;
		type: 'file' | 'directory';
		children?: FileNode[];
	}

	interface VectorStats {
		total: number;
		byType: Record<string, number>;
	}

	type Tab = 'notes' | 'search' | 'upload';

	let activeTab = $state<Tab>('notes');
	let fileTree = $state<FileNode[]>([]);
	let selectedFile = $state<string | null>(null);
	let fileContent = $state('');
	let originalContent = $state('');
	let isDirty = $derived(fileContent !== originalContent);
	let stats = $state<VectorStats>({ total: 0, byType: {} });

	// Load file tree and stats on mount
	$effect(() => {
		loadFileTree();
		loadStats();
	});

	async function loadFileTree() {
		try {
			const res = await fetch('/api/memory/files');
			fileTree = await res.json();
		} catch (error) {
			console.error('Failed to load file tree:', error);
		}
	}

	async function loadStats() {
		try {
			const res = await fetch('/api/memory/stats');
			stats = await res.json();
		} catch (error) {
			console.error('Failed to load stats:', error);
		}
	}

	async function selectFile(path: string) {
		if (isDirty) {
			const confirmed = confirm('You have unsaved changes. Discard them?');
			if (!confirmed) return;
		}

		selectedFile = path;
		activeTab = 'notes';

		try {
			const res = await fetch(`/api/memory/files/${encodeURIComponent(path)}`);
			if (res.ok) {
				const content = await res.text();
				fileContent = content;
				originalContent = content;
			}
		} catch (error) {
			console.error('Failed to load file:', error);
		}
	}

	async function saveFile(content: string) {
		if (!selectedFile) return;

		try {
			await fetch(`/api/memory/files/${encodeURIComponent(selectedFile)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content })
			});
			originalContent = content;
		} catch (error) {
			console.error('Failed to save file:', error);
		}
	}

	async function createFile() {
		const path = prompt('Enter file path (e.g., programming/svelte.md):');
		if (!path) return;

		const normalizedPath = path.endsWith('.md') ? path : `${path}.md`;

		try {
			await fetch('/api/memory/files', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					path: normalizedPath,
					content: `# ${normalizedPath.split('/').pop()?.replace('.md', '') || 'New Note'}\n\n`
				})
			});
			await loadFileTree();
			await selectFile(normalizedPath);
		} catch (error) {
			console.error('Failed to create file:', error);
		}
	}

	async function createFolder() {
		const path = prompt('Enter folder path (e.g., programming, food/recipes):');
		if (!path) return;

		// Create folder by creating a placeholder file, then we can delete it
		// Or we just create the dir via a file
		const placeholderPath = `${path}/.gitkeep`;

		try {
			await fetch('/api/memory/files', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: placeholderPath, content: '' })
			});
			await loadFileTree();
		} catch (error) {
			console.error('Failed to create folder:', error);
		}
	}

	async function deleteFile(path: string) {
		const confirmed = confirm(`Delete "${path}"?`);
		if (!confirmed) return;

		try {
			await fetch(`/api/memory/files/${encodeURIComponent(path)}`, {
				method: 'DELETE'
			});

			if (selectedFile === path) {
				selectedFile = null;
				fileContent = '';
				originalContent = '';
			}

			await loadFileTree();
		} catch (error) {
			console.error('Failed to delete file:', error);
		}
	}

	function deleteCurrentFile() {
		if (selectedFile) deleteFile(selectedFile);
	}
</script>

<svelte:head>
	<title>Memory - DrokBot</title>
</svelte:head>

<div class="flex h-screen overflow-hidden bg-base-100">
	<!-- Left Nav -->
	<div class="w-56 shrink-0">
		<NavMenu currentRoute="/memory" />
	</div>

	<!-- Center Content -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Tab bar -->
		<div class="border-b border-base-300 px-4 py-2">
			<div role="tablist" class="tabs-bordered tabs tabs-lg">
				<button
					role="tab"
					class="tab"
					class:tab-active={activeTab === 'notes'}
					onclick={() => (activeTab = 'notes')}
				>
					📝 Notes
				</button>
				<button
					role="tab"
					class="tab"
					class:tab-active={activeTab === 'search'}
					onclick={() => (activeTab = 'search')}
				>
					🔍 Vector Search
				</button>
				<button
					role="tab"
					class="tab"
					class:tab-active={activeTab === 'upload'}
					onclick={() => (activeTab = 'upload')}
				>
					📤 Upload
				</button>
			</div>
		</div>

		<!-- Tab content -->
		<div class="flex-1 overflow-hidden">
			{#if activeTab === 'notes'}
				{#if selectedFile}
					<MemoryEditor
						filePath={selectedFile}
						bind:content={fileContent}
						{isDirty}
						onSave={saveFile}
						onDelete={deleteCurrentFile}
					/>
				{:else}
					<div class="flex h-full items-center justify-center">
						<div class="text-center">
							<div class="mb-4 text-6xl opacity-20">📝</div>
							<h2 class="mb-2 text-xl font-semibold opacity-60">Memory Notes</h2>
							<p class="mb-4 text-sm opacity-40">
								Select a file from the sidebar or create a new one
							</p>
							<button class="btn btn-sm btn-primary" onclick={createFile}> Create Note </button>
						</div>
					</div>
				{/if}
			{:else if activeTab === 'search'}
				<VectorSearch />
			{:else if activeTab === 'upload'}
				<VectorUpload />
			{/if}
		</div>
	</div>

	<!-- Right Sidebar - File Tree + Stats -->
	<div class="flex w-64 shrink-0 flex-col border-l border-base-300">
		<div class="flex-1 overflow-hidden">
			<MemoryFileTree
				files={fileTree}
				{selectedFile}
				onSelect={selectFile}
				onNew={createFile}
				onNewFolder={createFolder}
				onDelete={deleteFile}
			/>
		</div>

		<!-- Stats panel -->
		<div class="border-t border-base-300 p-3">
			<h3 class="mb-2 text-xs font-semibold uppercase opacity-50">Vector Store</h3>
			<div class="flex flex-col gap-1 text-xs">
				<div class="flex justify-between">
					<span class="opacity-60">Total chunks</span>
					<span class="font-mono">{stats.total}</span>
				</div>
				{#each Object.entries(stats.byType) as [type, count] (type)}
					<div class="flex justify-between">
						<span class="opacity-60">{type}</span>
						<span class="font-mono">{count}</span>
					</div>
				{/each}
				{#if stats.total === 0}
					<span class="opacity-40">No memories stored yet</span>
				{/if}
			</div>
		</div>
	</div>
</div>
