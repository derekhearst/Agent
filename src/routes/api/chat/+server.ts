import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, chatSession, message, agentRun } from '$lib/shared/db';
import { generateSessionTitle } from '$lib/chat/chat.remote';
import type { ChatMessage } from '$lib/chat/chat.remote';
import { eq, desc } from 'drizzle-orm';
import { runAgent } from '$lib/chat/chat.remote';
import { storeChunks, chunkConversation } from '$lib/memory/memory.remote';
import { readMemoryFile } from '$lib/memory/memory.remote';

/**
 * Detect @agentname mentions and inject agent context into conversation.
 * Returns: { cleanedContent, agentContext }
 */
async function resolveAgentMentions(
	content: string
): Promise<{ cleanedContent: string; agentContext: string }> {
	const mentionRegex = /@([\w-]+)/g;
	const mentions = [...content.matchAll(mentionRegex)];

	if (mentions.length === 0) {
		return { cleanedContent: content, agentContext: '' };
	}

	const contextParts: string[] = [];

	for (const match of mentions) {
		const agentName = match[1];

		// Look up agent by name (case-insensitive)
		const agents = await db.query.agent.findMany();
		const found = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());

		if (found) {
			const parts: string[] = [];
			parts.push(`## Referenced Agent: ${found.name}`);
			parts.push(`Description: ${found.description}`);
			parts.push(`Schedule: ${found.cronSchedule}`);
			parts.push(
				`Last run: ${found.lastRunAt ? found.lastRunAt.toLocaleString() : 'Never'} (${found.lastRunStatus || 'N/A'})`
			);

			// Read memory.md
			try {
				const memory = await readMemoryFile(`${found.memoryPath}/memory.md`);
				if (memory.trim()) {
					parts.push(`\n### Agent Memory\n${memory}`);
				}
			} catch {
				// No memory file
			}

			// Get last run output
			const lastRun = await db.query.agentRun.findFirst({
				where: eq(agentRun.agentId, found.id),
				orderBy: [desc(agentRun.startedAt)]
			});

			if (lastRun?.output) {
				const output =
					lastRun.output.length > 600 ? lastRun.output.substring(0, 600) + '...' : lastRun.output;
				parts.push(`\n### Latest Run Output\n${output}`);
			}

			contextParts.push(parts.join('\n'));
		}
	}

	return {
		cleanedContent: content,
		agentContext:
			contextParts.length > 0
				? `\n\n## Agent Context (from @mentions)\nThe user referenced the following agent(s). Use this context to answer their question:\n\n${contextParts.join('\n\n---\n\n')}`
				: ''
	};
}

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

	// Resolve @agent mentions
	const lastMsg = messages[messages.length - 1]?.content || '';
	const { agentContext } = await resolveAgentMentions(lastMsg);

	// Stream the response via agent runner
	let fullContent = '';

	const readable = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				fullContent = await runAgent(
					messages,
					chatModel,
					(event) => {
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
									screenshots: event.images?.map(
										(img) => `data:${img.mimeType};base64,${img.base64}`
									)
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
					},
					agentContext || undefined
				);

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
