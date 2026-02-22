import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { db, chatSession, message } from '$lib/shared/db';
import { eq } from 'drizzle-orm';
import { streamChatWithTools } from '$lib/chat/chat';
import type { ChatMessage, AgentEvent } from '$lib/chat/chat';
import { buildDmSystemPrompt } from '$lib/dm/dm-prompt';
import { getDmToolDefinitions, executeDmTool, isDmTool } from '$lib/dm/dm-tools';
import { getToolDefinitions, executeTool, hasTools } from '$lib/tools/tools';
import { storeChunks } from '$lib/memory/memory.remote';
import { chunkConversation } from '$lib/memory/memory';

const MAX_TOOL_ITERATIONS = 50;
const MAX_EXECUTION_MS = 30 * 60 * 1000; // 30 minutes

export const POST = async ({ request }: RequestEvent) => {
	const { sessionId, campaignId, dmSessionId, content, model } = await request.json();

	if (!campaignId || !content) {
		return json({ error: 'campaignId and content are required' }, { status: 400 });
	}

	// If there's a chat session, save the user message
	const chatSessionId = sessionId;
	if (chatSessionId) {
		const session = await db.query.chatSession.findFirst({
			where: eq(chatSession.id, chatSessionId)
		});
		if (!session) {
			return json({ error: 'Chat session not found' }, { status: 404 });
		}

		await db.insert(message).values({
			sessionId: chatSessionId,
			role: 'user',
			content
		});

		await db
			.update(chatSession)
			.set({ messageCount: session.messageCount + 1, updatedAt: new Date() })
			.where(eq(chatSession.id, chatSessionId));
	}

	// Get message history
	let history: ChatMessage[] = [];
	if (chatSessionId) {
		const msgs = await db.query.message.findMany({
			where: eq(message.sessionId, chatSessionId),
			orderBy: (msg, { asc }) => [asc(msg.createdAt)]
		});
		history = msgs.map((m) => ({
			role: m.role as ChatMessage['role'],
			content: m.content
		}));
	} else {
		history = [{ role: 'user', content }];
	}

	const chatModel = model || 'moonshotai/kimi-k2.5';

	// Build DM-aware system prompt with campaign context + RAG
	const systemPrompt = await buildDmSystemPrompt(campaignId, dmSessionId, content);

	// Combine DM tools with standard tools (memory, search, etc.)
	const dmTools = getDmToolDefinitions(campaignId);
	const standardTools = hasTools() ? getToolDefinitions() : [];
	const allTools = [...dmTools, ...standardTools];

	const augmentedMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

	let fullContent = '';

	const readable = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(`data: ${JSON.stringify({ heartbeat: true })}\n\n`));

			const startTime = Date.now();

			try {
				for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
					const elapsed = Date.now() - startTime;
					if (elapsed > MAX_EXECUTION_MS) break;

					if (fullContent.trim() && iteration > 0) {
						fullContent += '\n\n';
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n' })}\n\n`));
					}

					const {
						content: iterContent,
						toolCalls,
						error
					} = await streamIteration(augmentedMessages, chatModel, allTools, (event) => {
						switch (event.type) {
							case 'content': {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify({ content: event.content })}\n\n`)
								);
								break;
							}
							case 'tool_status': {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ tool_status: 'searching', tool: event.tool, args: event.args })}\n\n`
									)
								);
								break;
							}
							case 'tool_result': {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ tool_status: 'complete', tool: event.tool, sources: event.sources })}\n\n`
									)
								);
								break;
							}
							case 'error': {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify({ error: event.error })}\n\n`)
								);
								break;
							}
						}
					});

					fullContent += iterContent;

					if (error) break;
					if (!toolCalls || toolCalls.length === 0) break;

					// Add assistant message with tool calls
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const assistantMsg: any = {
						role: 'assistant',
						content: iterContent || null,
						toolCalls: toolCalls.map((tc) => ({
							id: tc.id,
							type: 'function' as const,
							function: { name: tc.name, arguments: tc.arguments }
						}))
					};
					augmentedMessages.push(assistantMsg);

					// Execute tools
					for (const tc of toolCalls) {
						let args: Record<string, unknown> = {};
						try {
							args = JSON.parse(tc.arguments);
						} catch {
							args = {};
						}

						// Route to DM tools or standard tools
						let toolResult;
						if (isDmTool(tc.name)) {
							toolResult = await executeDmTool(tc.name, args, campaignId, dmSessionId);
						} else {
							toolResult = await executeTool(tc.name, args);
						}

						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const toolResponseMsg: any = {
							role: 'tool',
							content: toolResult.content,
							toolCallId: tc.id
						};
						augmentedMessages.push(toolResponseMsg);
					}
				}

				// Save assistant message if we have a chat session
				if (chatSessionId && fullContent.trim()) {
					const assistantMsg = await db
						.insert(message)
						.values({
							sessionId: chatSessionId,
							role: 'assistant',
							content: fullContent,
							model: chatModel
						})
						.returning();

					// Update message count
					const session = await db.query.chatSession.findFirst({
						where: eq(chatSession.id, chatSessionId)
					});
					if (session) {
						await db
							.update(chatSession)
							.set({ messageCount: session.messageCount + 1, updatedAt: new Date() })
							.where(eq(chatSession.id, chatSessionId));
					}

					// Auto-store in vector memory
					try {
						const lastMessages = history.slice(-4);
						lastMessages.push({ role: 'assistant', content: fullContent });
						const chunks = chunkConversation(lastMessages);
						if (chunks.length > 0) {
							storeChunks(
								chunks.map((text) => ({
									content: text,
									meta: {
										type: 'conversation' as const,
										source: `dm/${campaignId}/session-chat/${chatSessionId}`
									}
								}))
							).catch((err) => console.error('DM auto-store memory failed:', err));
						}
					} catch (err) {
						console.error('DM auto-store setup failed:', err);
					}

					// Send done event
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ done: true, messageId: assistantMsg[0]?.id })}\n\n`
						)
					);
				} else {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				}
			} catch (error) {
				console.error('DM chat stream error:', error);
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Stream failed' })}\n\n`
					)
				);
			} finally {
				controller.close();
			}
		}
	});

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

// ============== STREAM HELPER ==============

interface AccumulatedToolCall {
	id: string;
	name: string;
	arguments: string;
}

async function streamIteration(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	messages: any[],
	model: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: any[],
	onEvent: (event: AgentEvent) => void
): Promise<{ content: string; toolCalls: AccumulatedToolCall[] | null; error: string | null }> {
	try {
		const stream = await streamChatWithTools(messages, model, tools);

		let content = '';
		const toolCallMap = new Map<number, AccumulatedToolCall>();

		for await (const chunk of stream) {
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

			const rawDelta = delta?.content;
			const textDelta = typeof rawDelta === 'string' ? rawDelta : null;
			if (textDelta) {
				content += textDelta;
				onEvent({ type: 'content', content: textDelta });
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const toolCallDeltas = (delta as any)?.toolCalls as
				| Array<{
						index: number;
						id?: string;
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

			if (choice.finishReason === 'tool_calls') {
				return { content, toolCalls: Array.from(toolCallMap.values()), error: null };
			}

			if (choice.finishReason === 'stop' || choice.finishReason === 'length') {
				break;
			}
		}

		return { content, toolCalls: null, error: null };
	} catch (error) {
		return {
			content: '',
			toolCalls: null,
			error: error instanceof Error ? error.message : 'Stream failed'
		};
	}
}
