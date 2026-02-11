<script lang="ts">
	import NavMenu from '$lib/components/NavMenu.svelte';
	import GeometricPattern from '$lib/components/GeometricPattern.svelte';
	import MemoryFileTree from '$lib/memory/MemoryFileTree.svelte';
	import MemoryEditor from '$lib/memory/MemoryEditor.svelte';
	import VectorSearch from '$lib/memory/VectorSearch.svelte';
	import VectorUpload from '$lib/memory/VectorUpload.svelte';
	import {
		getFileTree,
		getFileContent,
		createFile as createFileRemote,
		updateFile as updateFileRemote,
		deleteFile as deleteFileRemote,
		getVectorStats
	} from '$lib/memory/memory.remote';

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
			fileTree = await getFileTree();
		} catch (error) {
			console.error('Failed to load file tree:', error);
		}
	}

	async function loadStats() {
		try {
			stats = await getVectorStats();
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
			const content = await getFileContent(path);
			fileContent = content;
			originalContent = content;
		} catch (error) {
			console.error('Failed to load file:', error);
		}
	}

	async function saveFile(content: string) {
		if (!selectedFile) return;

		try {
			await updateFileRemote({ path: selectedFile, content });
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
			await createFileRemote({
				path: normalizedPath,
				content: `# ${normalizedPath.split('/').pop()?.replace('.md', '') || 'New Note'}\n\n`
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

		// Create folder by creating a placeholder file
		const placeholderPath = `${path}/.gitkeep`;

		try {
			await createFileRemote({ path: placeholderPath, content: '' });
			await loadFileTree();
		} catch (error) {
			console.error('Failed to create folder:', error);
		}
	}

	async function deleteFile(path: string) {
		const confirmed = confirm(`Delete "${path}"?`);
		if (!confirmed) return;

		try {
			await deleteFileRemote(path);

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
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
			<div>
				<h1 class="text-lg font-semibold">Memory</h1>
				<p class="text-sm opacity-50">
					{stats.total} chunk{stats.total !== 1 ? 's' : ''} stored
				</p>
			</div>
			<div role="tablist" class="tabs-boxed tabs tabs-sm">
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
					🔍 Search
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
		<div class="relative flex-1 overflow-hidden">
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
					<GeometricPattern variant="dots" opacity={0.06} />
					<div class="relative z-10 flex h-full items-center justify-center">
						<div class="text-center">
							<div class="mb-4 text-6xl">📝</div>
							<h2
								class="mb-2 bg-gradient-to-r from-secondary to-accent bg-clip-text text-xl font-bold text-transparent"
							>
								Memory Notes
							</h2>
							<p class="mb-4 text-sm opacity-50">
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
