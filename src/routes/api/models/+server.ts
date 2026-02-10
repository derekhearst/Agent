import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export interface OpenRouterModel {
	id: string;
	name: string;
	description: string;
	context_length: number;
	architecture: {
		input_modalities: string[];
		output_modalities: string[];
		tokenizer: string;
		instruct_type: string | null;
	};
	pricing: {
		prompt: string;
		completion: string;
		request: string;
		image: string;
	};
	top_provider: {
		context_length: number;
		max_completion_tokens: number;
		is_moderated: boolean;
	};
	supported_parameters: string[];
}

// Cache models for 1 hour
let cachedModels: OpenRouterModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchModels(): Promise<OpenRouterModel[]> {
	const now = Date.now();
	if (cachedModels && now - cacheTimestamp < CACHE_TTL) {
		return cachedModels;
	}

	const res = await fetch('https://openrouter.ai/api/v1/models', {
		headers: {
			...(env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {})
		}
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch models: ${res.status}`);
	}

	const data = await res.json();
	cachedModels = data.data as OpenRouterModel[];
	cacheTimestamp = now;
	return cachedModels;
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const allModels = await fetchModels();

		// Optional filtering via query params
		const search = url.searchParams.get('search')?.toLowerCase();
		const modality = url.searchParams.get('modality'); // e.g., 'image', 'text'
		const capability = url.searchParams.get('capability'); // e.g., 'tools'

		let models = allModels;

		if (search) {
			models = models.filter(
				(m) => m.id.toLowerCase().includes(search) || m.name.toLowerCase().includes(search)
			);
		}

		if (modality) {
			models = models.filter(
				(m) =>
					m.architecture?.input_modalities?.includes(modality) ||
					m.architecture?.output_modalities?.includes(modality)
			);
		}

		if (capability) {
			models = models.filter((m) => m.supported_parameters?.includes(capability));
		}

		// Sort: free models first, then by name
		models.sort((a, b) => {
			const aFree = a.pricing?.prompt === '0' && a.pricing?.completion === '0';
			const bFree = b.pricing?.prompt === '0' && b.pricing?.completion === '0';
			if (aFree && !bFree) return -1;
			if (!aFree && bFree) return 1;
			return a.name.localeCompare(b.name);
		});

		// Return a slim version for the selector
		const slim = models.map((m) => ({
			id: m.id,
			name: m.name,
			context_length: m.context_length,
			input_modalities: m.architecture?.input_modalities || [],
			output_modalities: m.architecture?.output_modalities || [],
			pricing: {
				prompt: m.pricing?.prompt || '0',
				completion: m.pricing?.completion || '0'
			},
			supported_parameters: m.supported_parameters || [],
			isFree: m.pricing?.prompt === '0' && m.pricing?.completion === '0'
		}));

		return json(slim);
	} catch (error) {
		console.error('Failed to fetch models:', error);
		return json({ error: 'Failed to fetch models' }, { status: 500 });
	}
};
