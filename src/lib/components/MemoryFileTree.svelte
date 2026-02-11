<script lang="ts">
	interface FileNode {
		name: string;
		path: string;
		type: 'file' | 'directory';
		children?: FileNode[];
	}

	interface Props {
		files: FileNode[];
		selectedFile: string | null;
		onSelect: (path: string) => void;
		onNew: () => void;
		onNewFolder: () => void;
		onDelete: (path: string) => void;
	}

	import { SvelteSet } from 'svelte/reactivity';

	let { files, selectedFile, onSelect, onNew, onNewFolder, onDelete }: Props = $props();

	let expandedDirs = new SvelteSet<string>();

	function toggleDir(path: string) {
		if (expandedDirs.has(path)) {
			expandedDirs.delete(path);
		} else {
			expandedDirs.add(path);
		}
	}

	// Auto-expand directories when a file inside them is selected
	$effect(() => {
		if (selectedFile) {
			const parts = selectedFile.split('/');
			let current = '';
			for (let i = 0; i < parts.length - 1; i++) {
				current = current ? `${current}/${parts[i]}` : parts[i];
				expandedDirs.add(current);
			}
		}
	});
</script>

{#snippet renderTree(nodes: FileNode[], depth: number)}
	{#each nodes as node (node.path)}
		{#if node.type === 'directory'}
			<li>
				<button
					class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-base-300"
					style="padding-left: {depth * 12 + 8}px"
					onclick={() => toggleDir(node.path)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-3.5 w-3.5 shrink-0 transition-transform"
						class:rotate-90={expandedDirs.has(node.path)}
					>
						<path
							fill-rule="evenodd"
							d="M6.22 4.22a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06l-3.25 3.25a.75.75 0 01-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 010-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="h-4 w-4 shrink-0 text-warning"
					>
						<path
							d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75z"
						/>
						<path
							d="M3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z"
						/>
					</svg>
					<span class="truncate">{node.name}</span>
				</button>
				{#if expandedDirs.has(node.path) && node.children}
					<ul>
						{@render renderTree(node.children, depth + 1)}
					</ul>
				{/if}
			</li>
		{:else}
			<li>
				<div
					class="group flex w-full items-center justify-between rounded-md text-sm hover:bg-base-300"
					class:bg-base-300={selectedFile === node.path}
					class:font-medium={selectedFile === node.path}
				>
					<button
						class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
						style="padding-left: {depth * 12 + 8}px"
						onclick={() => onSelect(node.path)}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 20 20"
							fill="currentColor"
							class="h-4 w-4 shrink-0 opacity-50"
						>
							<path
								fill-rule="evenodd"
								d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
								clip-rule="evenodd"
							/>
						</svg>
						<span class="truncate">{node.name}</span>
					</button>
					<button
						class="btn mr-1 opacity-0 btn-ghost btn-xs group-hover:opacity-100"
						onclick={(e) => {
							e.stopPropagation();
							onDelete(node.path);
						}}
						title="Delete"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="h-3 w-3"
						>
							<path
								d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z"
							/>
						</svg>
					</button>
				</div>
			</li>
		{/if}
	{/each}
{/snippet}

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b border-base-300 p-3">
		<h2 class="text-sm font-semibold">Memory Files</h2>
		<div class="flex gap-1">
			<button class="btn btn-ghost btn-xs" onclick={onNewFolder} title="New Folder">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-4 w-4"
				>
					<path
						d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75z"
					/>
					<path
						d="M3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z"
					/>
				</svg>
			</button>
			<button class="btn btn-ghost btn-xs" onclick={onNew} title="New File">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-4 w-4"
				>
					<path
						d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
					/>
				</svg>
			</button>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if files.length === 0}
			<div class="p-4 text-center text-xs opacity-50">No memory files yet</div>
		{:else}
			<ul class="p-2">
				{@render renderTree(files, 0)}
			</ul>
		{/if}
	</div>
</div>
