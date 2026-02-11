// Markdown memory file service — reads/writes persistent knowledge files
// Uses Bun file APIs for dev (.storage/memory), production (/app/memory)
import { dev } from '$app/environment';
import { mkdir, readdir, readFile, writeFile, unlink, rm, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { existsSync } from 'node:fs';

export interface FileNode {
	name: string;
	path: string; // relative to MEMORY_DIR
	type: 'file' | 'directory';
	children?: FileNode[];
}

function getMemoryDir(): string {
	if (dev) {
		return join(process.cwd(), '.storage', 'memory');
	}
	return '/app/memory';
}

export const MEMORY_DIR = getMemoryDir();

/** Ensure the memory directory and a default profile.md exist */
export async function ensureMemoryDir(): Promise<void> {
	if (!existsSync(MEMORY_DIR)) {
		await mkdir(MEMORY_DIR, { recursive: true });
	}

	const profilePath = join(MEMORY_DIR, 'profile.md');
	if (!existsSync(profilePath)) {
		await writeFile(
			profilePath,
			`# User Profile

<!-- Add your preferences, habits, and important context here -->
<!-- The agent will read this file and inject it into every conversation -->

## Preferences

- 

## Notes

- 
`,
			'utf-8'
		);
	}
}

/** Read a memory file by relative path */
export async function readMemoryFile(relativePath: string): Promise<string> {
	const fullPath = join(MEMORY_DIR, relativePath);
	return await readFile(fullPath, 'utf-8');
}

/** Write a memory file by relative path, creating directories as needed */
export async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
	const fullPath = join(MEMORY_DIR, relativePath);
	const dir = dirname(fullPath);
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(fullPath, content, 'utf-8');
}

/** Delete a memory file or directory */
export async function deleteMemoryFile(relativePath: string): Promise<void> {
	const fullPath = join(MEMORY_DIR, relativePath);
	const stats = await stat(fullPath);
	if (stats.isDirectory()) {
		await rm(fullPath, { recursive: true });
	} else {
		await unlink(fullPath);
	}
}

/** Recursively list all memory files as a tree */
export async function listMemoryFiles(dir?: string): Promise<FileNode[]> {
	await ensureMemoryDir();
	const targetDir = dir ? join(MEMORY_DIR, dir) : MEMORY_DIR;

	if (!existsSync(targetDir)) return [];

	const entries = await readdir(targetDir, { withFileTypes: true });
	const nodes: FileNode[] = [];

	// Sort: directories first, then alphabetical
	const sorted = entries.sort((a, b) => {
		if (a.isDirectory() && !b.isDirectory()) return -1;
		if (!a.isDirectory() && b.isDirectory()) return 1;
		return a.name.localeCompare(b.name);
	});

	for (const entry of sorted) {
		const relativePath = relative(MEMORY_DIR, join(targetDir, entry.name));

		if (entry.isDirectory()) {
			const children = await listMemoryFiles(relativePath);
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

/** Read the profile.md file (always injected into system prompt) */
export async function getProfileMemory(): Promise<string | null> {
	try {
		await ensureMemoryDir();
		return await readMemoryFile('profile.md');
	} catch {
		return null;
	}
}

/** Get all markdown file paths recursively (flat list) */
export async function getAllMemoryFilePaths(dir?: string): Promise<string[]> {
	const targetDir = dir ? join(MEMORY_DIR, dir) : MEMORY_DIR;
	if (!existsSync(targetDir)) return [];

	const entries = await readdir(targetDir, { withFileTypes: true });
	const paths: string[] = [];

	for (const entry of entries) {
		const relativePath = relative(MEMORY_DIR, join(targetDir, entry.name));
		if (entry.isDirectory()) {
			const subPaths = await getAllMemoryFilePaths(relativePath);
			paths.push(...subPaths);
		} else if (entry.name.endsWith('.md')) {
			paths.push(relativePath);
		}
	}

	return paths;
}
