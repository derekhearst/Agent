import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, chatSession, message } from '$lib/shared/db';
import type { ChatMessage } from '$lib/chat/chat.remote';
import { eq } from 'drizzle-orm';
import { runAgent } from '$lib/chat/chat.remote';

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId, model } = await request.json();

	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = await db.query.chatSession.findFirst({
		where: eq(chatSession.id, sessionId)
	});

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Get current message history (should already have the last assistant msg removed)
	const history = await db.query.message.findMany({
		where: eq(message.sessionId, sessionId),
		orderBy: (msg, { asc }) => [asc(msg.createdAt)]
	});

	const messages: ChatMessage[] = history.map((msg) => ({
		role: msg.role as ChatMessage['role'],
		content: msg.content
	}));

	const chatModel = model || session.model || 'openrouter/auto';

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
								sources: event.sources,
								screenshots: event.images?.map((img) => `data:${img.mimeType};base64,${img.base64}`)
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
							break;
					}
				});

				// Save assistant message
				const assistantMsg = await db
					.insert(message)
					.values({
						sessionId,
						role: 'assistant',
						content: fullContent,
						model: chatModel
					})
					.returning();

				const newCount = history.length + 1;
				await db
					.update(chatSession)
					.set({ messageCount: newCount, updatedAt: new Date() })
					.where(eq(chatSession.id, sessionId));

				const doneData = JSON.stringify({
					done: true,
					messageId: assistantMsg[0]?.id
				});
				controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
			} catch (error) {
				console.error('Regenerate stream error:', error);
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
