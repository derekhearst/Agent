import { OpenRouter } from '@openrouter/sdk';
import { env } from '$env/dynamic/private';

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

export type ChatMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
};

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
