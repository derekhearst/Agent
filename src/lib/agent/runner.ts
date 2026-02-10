// Agent Runner — orchestrates the tool-calling loop
import { streamChatWithTools } from '$lib/server/openrouter';
import type { ChatMessage } from '$lib/server/openrouter';
import { getToolDefinitions, executeTool, hasTools } from '$lib/agent/tools';

const MAX_TOOL_ITERATIONS = 5;

const TOOL_SYSTEM_PROMPT = `You have access to tools that you can call when needed. Use the search_web tool when the user asks about current events, recent news, real-time data, or anything you're unsure about that would benefit from up-to-date information. When you use search results, always cite your sources with URLs. Do not call tools unless you actually need external information to answer the question.`;

export type AgentEvent =
	| { type: 'content'; content: string }
	| { type: 'tool_status'; tool: string; args: Record<string, unknown> }
	| {
			type: 'tool_result';
			tool: string;
			result: string;
			sources?: Array<{ title: string; url: string }>;
	  }
	| { type: 'error'; error: string }
	| { type: 'done'; content: string };

/**
 * Runs the agent loop: streams from the model, handles tool calls, feeds results back.
 * Calls onEvent for each SSE-worthy event.
 * Returns the full assembled assistant text content.
 */
export async function runAgent(
	messages: ChatMessage[],
	model: string,
	onEvent: (event: AgentEvent) => void
): Promise<string> {
	const tools = hasTools() ? getToolDefinitions() : [];

	// If no tools, fall back to simple streaming (no agent loop)
	if (tools.length === 0) {
		return await streamSimple(messages, model, onEvent);
	}

	// Inject system prompt for tool-aware models
	const augmentedMessages: ChatMessage[] = [
		{ role: 'system', content: TOOL_SYSTEM_PROMPT },
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
				sources: toolResult.meta?.sources
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const toolResponseMsg: any = {
				role: 'tool',
				content: toolResult.content,
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
	const { streamChat } = await import('$lib/server/openrouter');

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
