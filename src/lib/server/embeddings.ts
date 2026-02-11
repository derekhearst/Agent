// Embedding service — generates vector embeddings via OpenRouter
import { env } from '$env/dynamic/private';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const EMBEDDING_URL = 'https://openrouter.ai/api/v1/embeddings';

interface EmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

/**
 * Generate a single embedding vector for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
	const [result] = await generateEmbeddings([text]);
	return result;
}

/**
 * Generate embeddings for multiple texts in a single batch request.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const apiKey = env.OPENROUTER_API_KEY;
	if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

	const response = await fetch(EMBEDDING_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts,
			dimensions: EMBEDDING_DIMS
		})
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Embedding API error (${response.status}): ${err}`);
	}

	const data: EmbeddingResponse = await response.json();

	// Sort by index to ensure correct order
	const sorted = data.data.sort((a, b) => a.index - b.index);
	return sorted.map((d) => d.embedding);
}

export { EMBEDDING_DIMS };
