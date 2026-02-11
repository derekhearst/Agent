// Agent memory tools — recall, save, create/read/list notes
import type { ToolHandler } from '$lib/tools/tools';
import {
	searchMemoryInternal,
	storeChunk,
	readMemoryFile,
	writeMemoryFile,
	type MemoryType,
	type FileNode
} from '$lib/memory/memory.remote';

// Need to re-export listMemoryFiles functionality for the tool
import { dev } from '$app/environment';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';

function getMemoryDir(): string {
	if (dev) {
		return join(process.cwd(), '.storage', 'memory');
	}
	return '/app/memory';
}

const MEMORY_DIR = getMemoryDir();

async function listMemoryFilesInternal(dir?: string): Promise<FileNode[]> {
	const targetDir = dir ? join(MEMORY_DIR, dir) : MEMORY_DIR;

	if (!existsSync(targetDir)) return [];

	const entries = await readdir(targetDir, { withFileTypes: true });
	const nodes: FileNode[] = [];

	const sorted = entries.sort((a, b) => {
		if (a.isDirectory() && !b.isDirectory()) return -1;
		if (!a.isDirectory() && b.isDirectory()) return 1;
		return a.name.localeCompare(b.name);
	});

	for (const entry of sorted) {
		const relativePath = relative(MEMORY_DIR, join(targetDir, entry.name));

		if (entry.isDirectory()) {
			const children = await listMemoryFilesInternal(relativePath);
			nodes.push({
				name: entry.name,
				path: relativePath,
				type: 'directory',
				children
			});
		} else {
			nodes.push({
				name: entry.name,
				path: relativePath,
				type: 'file'
			});
		}
	}

	return nodes;
}

/** recall_memory — search the vector store and relevant notes */
export const recallMemoryTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'recall_memory',
			description:
				'Search your long-term memory for information from past conversations, stored knowledge, and notes. Use this when the user references something from the past, or when you need context that might have been discussed before.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'What to search for in memory. Be descriptive and specific.'
					},
					limit: {
						type: 'number',
						description: 'Maximum number of results to return (default: 5)'
					}
				},
				required: ['query']
			}
		}
	},
	async execute(args) {
		const query = args.query as string;
		const limit = (args.limit as number) || 5;

		const results = await searchMemoryInternal(query, limit);

		if (results.length === 0) {
			return { content: 'No relevant memories found.' };
		}

		const formatted = results
			.map((r, i) => {
				const similarity = Math.round((1 - r.distance) * 100);
				const date = new Date(r.createdAt * 1000).toLocaleDateString();
				return `[${i + 1}] (${similarity}% match, ${r.type}, ${date}) ${r.source}\n${r.content}`;
			})
			.join('\n\n---\n\n');

		return { content: `Found ${results.length} relevant memories:\n\n${formatted}` };
	}
};

/** save_memory — store a fact/insight into the vector store */
export const saveMemoryTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'save_memory',
			description:
				'Save an important fact, preference, decision, or piece of knowledge to long-term memory. Use this when the user shares preferences, makes decisions, or discusses something worth remembering for future conversations.',
			parameters: {
				type: 'object',
				properties: {
					content: {
						type: 'string',
						description:
							'The fact, preference, or knowledge to remember. Be clear and self-contained.'
					},
					type: {
						type: 'string',
						enum: ['knowledge', 'note'],
						description:
							'Type of memory: "knowledge" for facts/preferences, "note" for general notes'
					},
					source: {
						type: 'string',
						description:
							'Brief description of where this came from (e.g., "User preference", "Architecture decision")'
					}
				},
				required: ['content']
			}
		}
	},
	async execute(args) {
		const content = args.content as string;
		const type = (args.type as MemoryType) || 'knowledge';
		const source = (args.source as string) || 'Conversation';

		const id = await storeChunk(content, { type, source });
		return {
			content: `Saved to memory (id: ${id}): "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`
		};
	}
};

/** create_note — create or append to a markdown memory file */
export const createNoteTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'create_note',
			description:
				'Create or update a markdown note file in persistent memory. Use this for structured knowledge like recipes, project docs, guides, etc. Files are organized in folders (e.g., "food/recipes/carbonara.md", "programming/svelte.md").',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description:
							'File path relative to memory root (e.g., "food/recipes/pasta.md", "profile.md"). Must end in .md'
					},
					content: {
						type: 'string',
						description: 'The markdown content to write'
					},
					append: {
						type: 'boolean',
						description: 'If true, append to existing file instead of overwriting (default: false)'
					}
				},
				required: ['path', 'content']
			}
		}
	},
	async execute(args) {
		const path = args.path as string;
		const content = args.content as string;
		const append = args.append as boolean;

		if (!path.endsWith('.md')) {
			return { content: `Error: path must end in .md, got "${path}"` };
		}

		if (append) {
			try {
				const existing = await readMemoryFile(path);
				await writeMemoryFile(path, existing + '\n\n' + content);
			} catch {
				// File doesn't exist, just create it
				await writeMemoryFile(path, content);
			}
		} else {
			await writeMemoryFile(path, content);
		}

		return { content: `Note saved to "${path}"` };
	}
};

/** read_note — read a specific memory file */
export const readNoteTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'read_note',
			description: 'Read a specific markdown note file from persistent memory.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description:
							'File path relative to memory root (e.g., "profile.md", "food/recipes/pasta.md")'
					}
				},
				required: ['path']
			}
		}
	},
	async execute(args) {
		const path = args.path as string;

		try {
			const content = await readMemoryFile(path);
			return { content: `Contents of "${path}":\n\n${content}` };
		} catch {
			return { content: `File "${path}" not found.` };
		}
	}
};

/** list_notes — list the memory file tree */
export const listNotesTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'list_notes',
			description:
				'List all note files in persistent memory. Shows the folder/file tree structure.',
			parameters: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description:
							'Optional subdirectory to list (e.g., "food", "programming"). Lists all if omitted.'
					}
				}
			}
		}
	},
	async execute(args) {
		const directory = args.directory as string | undefined;
		const tree = await listMemoryFilesInternal(directory);

		if (tree.length === 0) {
			return { content: directory ? `No notes found in "${directory}/"` : 'No notes found.' };
		}

		function formatTree(nodes: FileNode[], indent: string = ''): string {
			return nodes
				.map((node) => {
					if (node.type === 'directory') {
						const children = node.children ? formatTree(node.children, indent + '  ') : '';
						return `${indent}📁 ${node.name}/\n${children}`;
					}
					return `${indent}📄 ${node.name}`;
				})
				.join('\n');
		}

		return { content: `Memory files:\n\n${formatTree(tree)}` };
	}
};
