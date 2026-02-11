import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { chatSession, message } from '$lib/server/db/schema';
import { generateSessionTitle } from '$lib/server/openrouter';
import type { ChatMessage } from '$lib/server/openrouter';
import { eq } from 'drizzle-orm';
import { runAgent } from '$lib/agent/runner';
import { storeChunks, chunkConversation } from '$lib/server/vector-store';

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, content, model } = await request.json();

	if (!sessionId || !content) {
		return json({ error: 'sessionId and content are required' }, { status: 400 });
	}

	// Get session
	const session = await db.query.chatSession.findFirst({
		where: eq(chatSession.id, sessionId)
	});

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Save user message to DB
	await db.insert(message).values({
		sessionId,
		role: 'user',
		content
	});

	// Increment message count
	const newCount = session.messageCount + 1;
	await db
		.update(chatSession)
		.set({ messageCount: newCount, updatedAt: new Date() })
		.where(eq(chatSession.id, sessionId));

	// Get full message history for this session
	const history = await db.query.message.findMany({
		where: eq(message.sessionId, sessionId),
		orderBy: (msg, { asc }) => [asc(msg.createdAt)]
	});

	const messages: ChatMessage[] = history.map((msg) => ({
		role: msg.role as ChatMessage['role'],
		content: msg.content
	}));

	// Use session model or provided model
	const chatModel = model || session.model || 'openrouter/auto';

	// Stream the response via agent runner
	let fullContent = '';

	const readable = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				fullContent = await runAgent(messages, chatModel, (event) => {
					switch (event.type) {
						case 'content': {
							const data = JSON.stringify({ content: event.content });
							controller.enqueue(encoder.encode(`data: ${data}\n\n`));
							break;
						}
						case 'tool_status': {
							const data = JSON.stringify({
								tool_status: 'searching',
								tool: event.tool,
								args: event.args
							});
							controller.enqueue(encoder.encode(`data: ${data}\n\n`));
							break;
						}
						case 'tool_result': {
							const data = JSON.stringify({
								tool_status: 'complete',
								tool: event.tool,
								sources: event.sources
							});
							controller.enqueue(encoder.encode(`data: ${data}\n\n`));
							break;
						}
						case 'error': {
							const data = JSON.stringify({ error: event.error });
							controller.enqueue(encoder.encode(`data: ${data}\n\n`));
							break;
						}
						case 'done':
							// Handled after runAgent returns
							break;
					}
				});

				// Save assistant message to DB
				const assistantMsg = await db
					.insert(message)
					.values({
						sessionId,
						role: 'assistant',
						content: fullContent,
						model: chatModel
					})
					.returning();

				// Increment message count for assistant message
				const updatedCount = newCount + 1;
				await db
					.update(chatSession)
					.set({ messageCount: updatedCount, updatedAt: new Date() })
					.where(eq(chatSession.id, sessionId));

				// Generate title on first response (count=2 means first exchange)
				// and every 10 messages after that
				const shouldGenerateTitle =
					updatedCount === 2 || (updatedCount > 2 && updatedCount % 10 === 0);

				let newTitle: string | undefined;
				if (shouldGenerateTitle) {
					try {
						const allMessages = await db.query.message.findMany({
							where: eq(message.sessionId, sessionId),
							orderBy: (msg, { asc }) => [asc(msg.createdAt)]
						});
						const chatMessages: ChatMessage[] = allMessages.map((msg) => ({
							role: msg.role as ChatMessage['role'],
							content: msg.content
						}));
						newTitle = await generateSessionTitle(chatMessages);
						await db
							.update(chatSession)
							.set({ title: newTitle })
							.where(eq(chatSession.id, sessionId));
					} catch (e) {
						console.error('Failed to generate title:', e);
					}
				}

				// Send done event
				const doneData = JSON.stringify({
					done: true,
					messageId: assistantMsg[0]?.id,
					...(newTitle ? { newTitle } : {})
				});
				controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));

				// Auto-store latest exchange in vector memory (fire-and-forget)
				try {
					const lastMessages = messages.slice(-4); // last 2 pairs
					lastMessages.push({ role: 'assistant', content: fullContent });
					const sessionTitle = newTitle || session.title || 'Chat';
					const chunks = chunkConversation(lastMessages);
					if (chunks.length > 0) {
						storeChunks(
							chunks.map((text) => ({
								content: text,
								meta: {
									sessionId,
									type: 'conversation' as const,
									source: `Chat: ${sessionTitle}`
								}
							}))
						).catch((err) => console.error('Auto-store memory failed:', err));
					}
				} catch (err) {
					console.error('Auto-store memory setup failed:', err);
				}
			} catch (error) {
				console.error('Stream error:', error);
				const errorData = JSON.stringify({
					error: error instanceof Error ? error.message : 'Stream failed'
				});
				controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
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
