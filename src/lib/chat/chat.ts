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

// ============== CONSTANTS ==============

/** Recommended model for browser/vision tasks */
export const VISION_MODEL = 'moonshotai/kimi-k2-instruct';

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
export async function streamChat(messages: ChatMessage[], model: string = 'moonshotai/kimi-k2.5') {
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
	model: string = 'moonshotai/kimi-k2.5',
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
	model: string = 'moonshotai/kimi-k2.5',
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
export async function chatSimple(messages: ChatMessage[], model: string = 'moonshotai/kimi-k2.5') {
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
			model: 'moonshotai/kimi-k2.5',
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

const MAX_TOOL_ITERATIONS = 1000; // Effectively unlimited
const MAX_EXECUTION_MS = 30 * 60 * 1000; // 30 minutes

const TOOL_SYSTEM_PROMPT = `You are a proactive AI assistant with full access to the user's tools. BE PROACTIVE — use tools immediately without asking for permission or clarification. When the user mentions ANYTHING that could be answered by your tools, USE THEM IMMEDIATELY.

## Critical Behavior Rules
1. NEVER ask clarifying questions when you can infer what the user wants
2. NEVER ask "which account" or "what search terms" — just use sensible defaults and search
3. When the user mentions purchases, orders, emails, calendar, finances, etc. — immediately use the relevant tools
4. If the user's request is ambiguous, make reasonable assumptions and proceed
5. Cite your sources with URLs when using web search results
6. BATCH TOOL CALLS: Call multiple tools in parallel when possible. For example, if you need to read 5 emails, call read_email 5 times in a SINGLE response, not one at a time across multiple turns.

## Tools Available

### Memory Tools
- recall_memory: Search long-term memory for past conversations and knowledge
- save_memory: Save important facts, preferences, decisions to memory
- create_note: Create/update markdown notes for structured knowledge
- read_note: Read a specific note file
- list_notes: Browse the notes file tree

### Web & Browser Tools
- search_web: Search the web for current information — use for news, facts, real-time data
- browse_url: Navigate to a URL and get page content + screenshot
- browser_act: Perform actions on the page (click, type, scroll, etc.)
- browser_extract: Extract specific information from the current page
- browser_screenshot: Take a screenshot of the current browser page
- browser_close: Close the browser session

NOTE: Browser tools return screenshots. For best results, use a vision-capable model like moonshotai/kimi-k2-instruct.

### Finance Tool
- get_finances: Get financial overview from Actual Budget — account balances, budget breakdown, recent transactions. Use when user asks about spending, money, budget.

### Gmail & Calendar Tools (FULL READ ACCESS — NO PERMISSION NEEDED)
- search_email: Search Gmail using query syntax (from:, subject:, is:unread, after:YYYY/MM/DD, etc.)
- read_email: Read full email content by Gmail message ID (the hex ID from search/list results)
- list_emails: List recent emails from a label (INBOX, SENT, etc.)
- list_calendar_events: List upcoming calendar events with times, locations, attendees
- check_availability: Check free/busy status for a date

## Email Behavior (CRITICAL)
When the user asks ANYTHING about emails, purchases, orders, receipts, confirmations, or communications:
1. IMMEDIATELY search their Gmail with appropriate terms — do NOT ask what to search
2. READ the relevant emails (up to 5) IN PARALLEL — call multiple read_email in ONE response, not one per turn
3. SUMMARIZE the actual content and answer their question
4. COMPLETE THE TASK — don't stop after reading emails, provide the final analysis/categorization the user asked for

Examples of what to search automatically:
- "my purchases" → search_email with "subject:order OR subject:receipt OR subject:confirmation"
- "amazon orders" → search_email with "from:amazon subject:order"
- "what did I buy" → search_email with "subject:order OR subject:purchase OR subject:shipped"
- "misc purchases" → get_finances to see transactions, then search_email to match receipts

NEVER respond with "which email account" or "what should I search for" — you have Gmail access, just use it.`;

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
		const allPaths = await getAllMemoryFilePaths(undefined);
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
			const memories = await searchMemoryInternal({ query: userMessage, limit: 3 });
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
	const startTime = Date.now();
	console.log(`🤖 runAgent: Starting with model=${model}, messages=${messages.length}`);

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
		// Check time limit
		const elapsed = Date.now() - startTime;
		if (elapsed > MAX_EXECUTION_MS) {
			const mins = Math.floor(elapsed / 60000);
			console.warn(`🤖 runAgent: Time limit reached (${mins} minutes)`);
			onEvent({
				type: 'error',
				error: `Execution time limit reached (${mins} minutes). Stopping.`
			});
			break;
		}

		console.log(`🤖 runAgent: Iteration ${iteration + 1} (${Math.floor(elapsed / 1000)}s elapsed)`);
		const iterStart = Date.now();

		// Add separator BEFORE streaming new content if we already have content
		if (fullContent.trim()) {
			fullContent += '\n\n';
			onEvent({ type: 'content', content: '\n\n' });
		}

		const { content, toolCalls, error } = await streamWithToolAccumulation(
			augmentedMessages,
			model,
			tools,
			onEvent
		);

		console.log(
			`🤖 runAgent: Iteration ${iteration + 1} done in ${Date.now() - iterStart}ms — ` +
				`content=${content.length}chars, tools=${toolCalls?.length || 0}, error=${error || 'none'}`
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

			// Build tool response
			// Note: Tool messages only support string content (not arrays with images)
			// If images were returned, we describe them in the text and include as a separate user message
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const toolResponseMsg: any = {
				role: 'tool',
				content: toolResult.content,
				toolCallId: tc.id
			};
			augmentedMessages.push(toolResponseMsg);

			// If images were returned, add them as a user message so the model can see them
			if (toolResult.images?.length) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const imageMsg: any = {
					role: 'user',
					content: [
						{ type: 'text', text: `[Screenshot from ${tc.name} tool - analyze this image]` },
						...toolResult.images.map((img) => ({
							type: 'image_url',
							imageUrl: { url: `data:${img.mimeType};base64,${img.base64}` }
						}))
					]
				};
				augmentedMessages.push(imageMsg);
			}
		}

		// Loop continues — model will now respond with the tool results in context
	}

	// If we got absolutely nothing, surface an error
	if (!fullContent.trim()) {
		const fallbackError = 'Model returned no response. This may be a timeout or model error.';
		console.error(`🤖 runAgent: Empty response after ${Date.now() - startTime}ms`);
		onEvent({ type: 'error', error: fallbackError });
		fullContent = `*${fallbackError}*`;
	}

	console.log(`🤖 runAgent: Complete in ${Date.now() - startTime}ms — ${fullContent.length} chars`);
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
			const delay = attempt * 2000; // 2s, 4s
			console.log(
				`⟳ Retrying OpenRouter call (attempt ${attempt + 1}/${MAX_STREAM_RETRIES + 1}) after ${delay / 1000}s...`
			);
			// Emit a status so the UI knows we're retrying
			onEvent({ type: 'content', content: '' }); // Keep stream alive
			await new Promise((r) => setTimeout(r, delay));
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
			// Empty response with no error - model returned nothing
			if (!result.content && !result.error) {
				lastError = 'Model returned empty response';
				console.warn(`Stream attempt ${attempt + 1}: empty response, retrying...`);
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
	const streamStart = Date.now();
	console.log(`📡 Starting stream with model=${model}, tools=${tools.length}`);

	const stream = await streamChatWithTools(messages, model, tools);

	let content = '';
	const toolCallMap = new Map<number, AccumulatedToolCall>();
	let chunkCount = 0;

	try {
		for await (const chunk of stream) {
			chunkCount++;

			// Check for errors
			if ('error' in chunk && chunk.error) {
				const errorMsg =
					typeof chunk.error === 'object' && chunk.error !== null && 'message' in chunk.error
						? (chunk.error as { message: string }).message
						: 'Stream error';
				console.log(`📡 Stream error after ${chunkCount} chunks: ${errorMsg}`);
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
				console.log(
					`📡 Stream done (tool_calls) in ${Date.now() - streamStart}ms — ${chunkCount} chunks, ` +
						`${content.length} chars, ${toolCalls.length} tools`
				);
				return { content, toolCalls, error: null };
			}

			if (choice.finishReason === 'stop' || choice.finishReason === 'length') {
				console.log(
					`📡 Stream done (${choice.finishReason}) in ${Date.now() - streamStart}ms — ` +
						`${chunkCount} chunks, ${content.length} chars`
				);
				break;
			}
		}
	} catch (error) {
		// Format error message - handle Zod validation error arrays from SDK
		let errorMsg: string;
		if (Array.isArray(error)) {
			// Zod validation errors from SDK come as arrays
			errorMsg = `SDK validation: ${error.map((e) => e.message || e.code).join('; ')}`;
		} else if (error instanceof Error) {
			errorMsg = error.message;
		} else {
			errorMsg = 'Stream failed';
		}

		// If we have content, treat as partial success (stream may have thrown on cleanup)
		if (content.length > 0) {
			console.log(
				`📡 Stream threw after ${chunkCount} chunks but got ${content.length} chars — ${errorMsg}`
			);
			// Check if we have any accumulated tool calls
			const toolCalls = toolCallMap.size > 0 ? Array.from(toolCallMap.values()) : null;
			return { content, toolCalls, error: null };
		}

		console.log(`📡 Stream threw after ${chunkCount} chunks: ${errorMsg}`);
		return { content, toolCalls: null, error: errorMsg };
	}

	// If we got here without a finish reason, log it
	console.log(
		`📡 Stream ended without finish reason in ${Date.now() - streamStart}ms — ` +
			`${chunkCount} chunks, ${content.length} chars, ${toolCallMap.size} partial tools`
	);

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
