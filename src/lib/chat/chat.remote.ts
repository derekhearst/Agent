// Chat module — OpenRouter client and streaming agent runner
import { OpenRouter } from '@openrouter/sdk';
import { env } from '$env/dynamic/private';
import { getToolDefinitions, executeTool, hasTools } from '$lib/tools/tools';
import {
	getProfileMemory,
	getAllMemoryFilePaths,
	readMemoryFile,
	searchMemoryInternal
} from '$lib/memory/memory.remote';

// ============== TYPES ==============

export type ChatMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
};

export type AgentEvent =
	| { type: 'content'; content: string }
	| { type: 'tool_status'; tool: string; args: Record<string, unknown> }
	| {
			type: 'tool_result';
			tool: string;
			result: string;
			sources?: Array<{ title: string; url: string }>;
			images?: Array<{ mimeType: string; base64: string }>;
	  }
	| { type: 'error'; error: string }
	| { type: 'done'; content: string };

// ============== PRIVATE: OPENROUTER CLIENT ==============

function getClient() {
	if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');

	return new OpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
		timeoutMs: 60000, // 60s timeout
		retryConfig: {
			strategy: 'backoff',
			backoff: { initialInterval: 1000, maxInterval: 10000, exponent: 1.5, maxElapsedTime: 120000 },
			retryConnectionErrors: true
		}
	});
}

// ============== EXPORTED CHAT FUNCTIONS ==============

/**
 * Stream a chat completion from OpenRouter.
 * Returns an async iterable of chunks.
 */
export async function streamChat(messages: ChatMessage[], model: string = 'openrouter/auto') {
	const client = getClient();

	const stream = await client.chat.send({
		chatGenerationParams: {
			model,
			messages,
			stream: true
		}
	});

	return stream;
}

/**
 * Stream a chat completion with tool definitions.
 * The model may respond with tool_calls in the stream delta.
 */
export async function streamChatWithTools(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	messages: any[],
	model: string = 'openrouter/auto',
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: any[]
) {
	const client = getClient();

	const stream = await client.chat.send({
		chatGenerationParams: {
			model,
			messages,
			tools,
			toolChoice: 'auto',
			stream: true
		}
	});

	return stream;
}

/**
 * Non-streaming chat completion with tool definitions.
 * Used for scheduled agent runs where we don't need SSE.
 */
export async function chatWithTools(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	messages: any[],
	model: string = 'openrouter/auto',
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: any[]
) {
	const client = getClient();

	const completion = await client.chat.send({
		chatGenerationParams: {
			model,
			messages,
			tools,
			toolChoice: 'auto',
			stream: false
		}
	});

	return completion;
}

/**
 * Non-streaming simple chat completion (no tools).
 */
export async function chatSimple(messages: ChatMessage[], model: string = 'openrouter/auto') {
	const client = getClient();

	const completion = await client.chat.send({
		chatGenerationParams: {
			model,
			messages,
			stream: false
		}
	});

	return completion;
}

/**
 * Generate a short title for a chat session based on the conversation so far.
 * Uses a cheap/fast model for title generation.
 */
export async function generateSessionTitle(messages: ChatMessage[]): Promise<string> {
	const client = getClient();

	const titleMessages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'Generate a very short title (3-6 words max) for this conversation. Respond with ONLY the title, no quotes, no punctuation at the end, no explanation.'
		},
		...messages.slice(0, 6), // Use first few messages for context
		{
			role: 'user',
			content: 'Generate a short title for the conversation above.'
		}
	];

	const completion = await client.chat.send({
		chatGenerationParams: {
			model: 'openrouter/auto',
			messages: titleMessages,
			stream: false
		}
	});

	const content = completion.choices?.[0]?.message?.content;
	const title = (typeof content === 'string' ? content.trim() : null) || 'New Chat';
	// Truncate if too long
	return title.length > 60 ? title.substring(0, 57) + '...' : title;
}

// ============== AGENT RUNNER ==============

const MAX_TOOL_ITERATIONS = 5;

const TOOL_SYSTEM_PROMPT = `You have access to tools that you can call when needed. Use the search_web tool when the user asks about current events, recent news, real-time data, or anything you're unsure about that would benefit from up-to-date information. When you use search results, always cite your sources with URLs. Do not call tools unless you actually need external information to answer the question.

You have memory tools available:
- recall_memory: Search your long-term memory for past conversations, facts, and knowledge. Use this when the user references something from the past.
- save_memory: Save important facts, preferences, or decisions to long-term memory. Use this when the user shares preferences, makes important decisions, or tells you something worth remembering.
- create_note: Create persistent markdown notes organized in folders. Use for structured knowledge (recipes, project docs, guides, etc.).
- read_note: Read a specific note file.
- list_notes: Browse the notes file tree.

When the user shares preferences, important facts, or asks you to remember something, proactively use save_memory or create_note to persist it. You don't need to ask permission to save memories.

You have browser tools available for browsing the web:
- browse_url: Navigate to a URL and get the page content + a screenshot. Use this to visit websites, read articles, or start browsing.
- browser_act: Perform actions on the current page — click buttons/links, type in fields, scroll, go back/forward, press keys.
- browser_extract: Pull specific information from the current page (text + screenshot).
- browser_screenshot: Take a screenshot to see the current state of the page.
- browser_close: Close the browser session when done.

When browsing, use browse_url first to navigate, then use browser_act to interact with the page. You will receive screenshots so you can see what's on the page. For best results, use a vision-capable model.

You have a finance tool:
- get_finances: Retrieve a read-only financial overview from Actual Budget — account balances, budget breakdown (budgeted vs spent vs balance per category), and recent transactions. Use when the user asks about their finances, spending, budget, account balances, or money. Optionally pass a month (YYYY-MM) and/or number of days of transactions to include.`;

/**
 * Build a dynamic system prompt with memory context injected.
 */
async function buildSystemPrompt(userMessage: string): Promise<string> {
	let prompt = TOOL_SYSTEM_PROMPT;

	// Always inject profile.md
	try {
		const profile = await getProfileMemory();
		if (profile && profile.trim()) {
			prompt += `\n\n## User Profile\n${profile}`;
		}
	} catch {
		// Profile not available, skip
	}

	// Search for relevant markdown files based on user message
	try {
		const allPaths = await getAllMemoryFilePaths();
		// Skip profile.md since it's already injected
		const otherPaths = allPaths.filter((p) => p !== 'profile.md');

		if (otherPaths.length > 0 && userMessage) {
			// For a small number of files, just inject them all
			if (otherPaths.length <= 5) {
				const contents: string[] = [];
				for (const p of otherPaths) {
					try {
						const content = await readMemoryFile(p);
						if (content.trim()) {
							contents.push(`### ${p}\n${content}`);
						}
					} catch {
						// skip unreadable files
					}
				}
				if (contents.length > 0) {
					prompt += `\n\n## Memory Notes\n${contents.join('\n\n')}`;
				}
			} else {
				// For many files, just list them so the agent knows what's available
				prompt += `\n\n## Available Notes\nYou have ${otherPaths.length} note files. Use list_notes and read_note to access them. Files: ${otherPaths.join(', ')}`;
			}
		}
	} catch {
		// Memory files not available, skip
	}

	// Search vector store for relevant past context
	try {
		if (userMessage) {
			const memories = await searchMemoryInternal(userMessage, 3);
			if (memories.length > 0) {
				const memoryText = memories
					.map((m) => {
						const similarity = Math.round((1 - m.distance) * 100);
						return `- (${similarity}% match, ${m.type}) ${m.content}`;
					})
					.join('\n');
				prompt += `\n\n## Related Past Context\n${memoryText}`;
			}
		}
	} catch {
		// Vector search not available, skip
	}

	return prompt;
}

/**
 * Runs the agent loop: streams from the model, handles tool calls, feeds results back.
 * Calls onEvent for each SSE-worthy event.
 * Returns the full assembled assistant text content.
 */
export async function runAgent(
	messages: ChatMessage[],
	model: string,
	onEvent: (event: AgentEvent) => void,
	extraSystemContext?: string
): Promise<string> {
	const tools = hasTools() ? getToolDefinitions() : [];

	// If no tools, fall back to simple streaming (no agent loop)
	if (tools.length === 0) {
		return await streamSimple(messages, model, onEvent);
	}

	// Build dynamic system prompt with memory context
	const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
	const systemPrompt = await buildSystemPrompt(lastUserMsg);

	// Inject system prompt for tool-aware models
	const augmentedMessages: ChatMessage[] = [
		{ role: 'system', content: systemPrompt + (extraSystemContext || '') },
		...messages
	];

	let fullContent = '';

	for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
		const { content, toolCalls, error } = await streamWithToolAccumulation(
			augmentedMessages,
			model,
			tools,
			onEvent
		);

		fullContent += content;

		if (error) {
			onEvent({ type: 'error', error });
			break;
		}

		// No tool calls — model is done
		if (!toolCalls || toolCalls.length === 0) {
			break;
		}

		// Model wants to call tools — build the assistant message with tool calls
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const assistantMsg: any = {
			role: 'assistant',
			content: content || null,
			toolCalls: toolCalls.map((tc) => ({
				id: tc.id,
				type: 'function' as const,
				function: {
					name: tc.name,
					arguments: tc.arguments
				}
			}))
		};
		augmentedMessages.push(assistantMsg);

		// Execute each tool and send results back
		for (const tc of toolCalls) {
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(tc.arguments);
			} catch {
				args = {};
			}

			onEvent({ type: 'tool_status', tool: tc.name, args });

			const toolResult = await executeTool(tc.name, args);

			onEvent({
				type: 'tool_result',
				tool: tc.name,
				result: toolResult.content,
				sources: toolResult.meta?.sources,
				images: toolResult.images
			});

			// Build tool response — with vision content if images are present
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const toolResponseMsg: any = {
				role: 'tool',
				content: toolResult.images?.length
					? [
							{ type: 'text', text: toolResult.content },
							...toolResult.images.map((img) => ({
								type: 'image_url',
								image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
							}))
						]
					: toolResult.content,
				toolCallId: tc.id
			};
			augmentedMessages.push(toolResponseMsg);
		}

		// Loop continues — model will now respond with the tool results in context
	}

	onEvent({ type: 'done', content: fullContent });
	return fullContent;
}

interface AccumulatedToolCall {
	id: string;
	name: string;
	arguments: string;
}

interface StreamResult {
	content: string;
	toolCalls: AccumulatedToolCall[] | null;
	error: string | null;
}

const MAX_STREAM_RETRIES = 2;

async function streamWithToolAccumulation(
	messages: ChatMessage[],
	model: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: any[],
	onEvent: (event: AgentEvent) => void
): Promise<StreamResult> {
	let lastError = '';

	for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
		if (attempt > 0) {
			console.log(
				`⟳ Retrying OpenRouter call (attempt ${attempt + 1}/${MAX_STREAM_RETRIES + 1})...`
			);
			// Wait before retry: 2s, 5s
			await new Promise((r) => setTimeout(r, attempt * 3000));
		}

		try {
			const result = await _streamWithToolAccumulationOnce(messages, model, tools, onEvent);
			// If we got content or tool calls, return even if there was an error
			if (result.content || result.toolCalls) return result;
			// If error but no content, retry
			if (result.error) {
				lastError = result.error;
				console.error(`Stream attempt ${attempt + 1} failed: ${result.error}`);
				continue;
			}
			return result;
		} catch (error) {
			lastError = error instanceof Error ? error.message : 'Stream failed';
			console.error(`Stream attempt ${attempt + 1} threw: ${lastError}`);
		}
	}

	return {
		content: '',
		toolCalls: null,
		error: `Failed after ${MAX_STREAM_RETRIES + 1} attempts: ${lastError}`
	};
}

async function _streamWithToolAccumulationOnce(
	messages: ChatMessage[],
	model: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: any[],
	onEvent: (event: AgentEvent) => void
): Promise<StreamResult> {
	const stream = await streamChatWithTools(messages, model, tools);

	let content = '';
	const toolCallMap = new Map<number, AccumulatedToolCall>();

	try {
		for await (const chunk of stream) {
			// Check for errors
			if ('error' in chunk && chunk.error) {
				const errorMsg =
					typeof chunk.error === 'object' && chunk.error !== null && 'message' in chunk.error
						? (chunk.error as { message: string }).message
						: 'Stream error';
				return { content, toolCalls: null, error: errorMsg };
			}

			const choice = chunk.choices?.[0];
			if (!choice) continue;
			const delta = choice.delta;

			// Accumulate text content
			const rawDelta = delta?.content;
			const textDelta = typeof rawDelta === 'string' ? rawDelta : null;
			if (textDelta) {
				content += textDelta;
				onEvent({ type: 'content', content: textDelta });
			}

			// Accumulate tool call deltas
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const toolCallDeltas = (delta as any)?.toolCalls as
				| Array<{
						index: number;
						id?: string;
						type?: string;
						function?: { name?: string; arguments?: string };
				  }>
				| undefined;

			if (toolCallDeltas) {
				for (const tc of toolCallDeltas) {
					if (!toolCallMap.has(tc.index)) {
						toolCallMap.set(tc.index, { id: '', name: '', arguments: '' });
					}
					const existing = toolCallMap.get(tc.index)!;
					if (tc.id) existing.id = tc.id;
					if (tc.function?.name) existing.name = tc.function.name;
					if (tc.function?.arguments) existing.arguments += tc.function.arguments;
				}
			}

			// Check finish reason
			if (choice.finishReason === 'tool_calls') {
				const toolCalls = Array.from(toolCallMap.values());
				return { content, toolCalls, error: null };
			}

			if (choice.finishReason === 'stop' || choice.finishReason === 'length') {
				break;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Stream failed';
		return { content, toolCalls: null, error: errorMsg };
	}

	return { content, toolCalls: null, error: null };
}

/** Simple streaming fallback for non-tool models */
async function streamSimple(
	messages: ChatMessage[],
	model: string,
	onEvent: (event: AgentEvent) => void
): Promise<string> {
	let fullContent = '';
	let lastError = '';

	for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
		if (attempt > 0) {
			console.log(`⟳ Retrying simple stream (attempt ${attempt + 1}/${MAX_STREAM_RETRIES + 1})...`);
			await new Promise((r) => setTimeout(r, attempt * 3000));
		}

		try {
			const stream = await streamChat(messages, model);
			let failed = false;

			for await (const chunk of stream) {
				if ('error' in chunk && chunk.error) {
					const errorMsg =
						typeof chunk.error === 'object' && chunk.error !== null && 'message' in chunk.error
							? (chunk.error as { message: string }).message
							: 'Stream error';
					lastError = errorMsg;
					failed = true;
					break;
				}

				const rawDelta = chunk.choices?.[0]?.delta?.content;
				const delta = typeof rawDelta === 'string' ? rawDelta : null;
				if (delta) {
					fullContent += delta;
					onEvent({ type: 'content', content: delta });
				}

				if (chunk.choices?.[0]?.finishReason) {
					break;
				}
			}

			if (!failed) break;
			// If we already got some content, don't retry
			if (fullContent) break;
		} catch (error) {
			lastError = error instanceof Error ? error.message : 'Stream failed';
			console.error(`Simple stream attempt ${attempt + 1} threw: ${lastError}`);
			if (fullContent) break; // Don't retry if we got partial content
		}
	}

	if (!fullContent && lastError) {
		onEvent({ type: 'error', error: lastError });
	}

	onEvent({ type: 'done', content: fullContent });
	return fullContent;
}
