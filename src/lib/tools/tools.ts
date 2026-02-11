// Tool Registry — extensible system for agent tools

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ToolExecuteResult {
	/** The text content to send back to the model */
	content: string;
	/** Optional images to send back to the model (for vision-capable models) */
	images?: Array<{ mimeType: string; base64: string }>;
	/** Optional metadata to surface to the UI (e.g. sources searched) */
	meta?: {
		sources?: Array<{ title: string; url: string }>;
	};
}

export interface ToolHandler {
	definition: ToolDefinition;
	execute: (args: Record<string, unknown>) => Promise<ToolExecuteResult>;
}

/** All registered tools, keyed by function name */
const registry = new Map<string, ToolHandler>();

/** Register a tool handler */
export function registerTool(handler: ToolHandler) {
	if (!handler || !handler.definition) {
		console.error('registerTool called with undefined handler or definition');
		return;
	}
	registry.set(handler.definition.function.name, handler);
}

/** Get OpenRouter-compatible tool definitions array */
export function getToolDefinitions(): ToolDefinition[] {
	return Array.from(registry.values()).map((h) => h.definition);
}

/** Execute a tool by name with the given args */
export async function executeTool(
	name: string,
	args: Record<string, unknown>
): Promise<ToolExecuteResult> {
	const handler = registry.get(name);
	if (!handler) {
		return { content: `Error: Unknown tool "${name}"` };
	}
	try {
		return await handler.execute(args);
	} catch (error) {
		console.error(`Tool "${name}" execution error:`, error);
		return {
			content: `Error executing tool "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

/** Check if any tools are registered */
export function hasTools(): boolean {
	return registry.size > 0;
}

// ------ Register all tools below ------
import { searchWebTool } from '$lib/tools/search';
import {
	recallMemoryTool,
	saveMemoryTool,
	createNoteTool,
	readNoteTool,
	listNotesTool
} from '$lib/memory/memory';
import { askAgentTool, listAgentsTool } from '$lib/agents/agents';
import {
	browseUrlTool,
	browserActTool,
	browserExtractTool,
	browserScreenshotTool,
	browserCloseTool
} from '$lib/tools/browser';
import { getFinancesTool } from '$lib/tools/budget';

registerTool(searchWebTool);
registerTool(recallMemoryTool);
registerTool(saveMemoryTool);
registerTool(createNoteTool);
registerTool(readNoteTool);
registerTool(listNotesTool);
registerTool(askAgentTool);
registerTool(listAgentsTool);
registerTool(browseUrlTool);
registerTool(browserActTool);
registerTool(browserExtractTool);
registerTool(browserScreenshotTool);
registerTool(browserCloseTool);
registerTool(getFinancesTool);
