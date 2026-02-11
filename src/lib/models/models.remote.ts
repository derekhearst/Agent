// Models module — OpenRouter model discovery and caching
import { z } from 'zod';
import { query } from '$app/server';
import { db, modelsCache } from '$lib/shared/db';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

export interface SlimModel {
	id: string;
	name: string;
	context_length: number;
	input_modalities: string[];
	output_modalities: string[];
	pricing: { prompt: string; completion: string };
	supported_parameters: string[];
	isFree: boolean;
}

interface OpenRouterModel {
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

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const CACHE_KEY = 'openrouter_models';

async function fetchAndCacheModels(): Promise<SlimModel[]> {
	// Check DB cache
	const cached = await db.query.modelsCache.findFirst({
		where: eq(modelsCache.id, CACHE_KEY)
	});

	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
		return JSON.parse(cached.data);
	}

	// Fetch fresh from OpenRouter
	const res = await fetch('https://openrouter.ai/api/v1/models', {
		headers: {
			...(env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {})
		}
	});

	if (!res.ok) {
		// If we have stale cache, return it rather than failing
		if (cached) return JSON.parse(cached.data);
		throw new Error(`Failed to fetch models: ${res.status}`);
	}

	const data = await res.json();
	const allModels = data.data as OpenRouterModel[];

	// Sort: free models first, then by name
	allModels.sort((a, b) => {
		const aFree = a.pricing?.prompt === '0' && a.pricing?.completion === '0';
		const bFree = b.pricing?.prompt === '0' && b.pricing?.completion === '0';
		if (aFree && !bFree) return -1;
		if (!aFree && bFree) return 1;
		return a.name.localeCompare(b.name);
	});

	// Create slim version
	const slim: SlimModel[] = allModels.map((m) => ({
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

	// Store in DB cache
	await db
		.insert(modelsCache)
		.values({
			id: CACHE_KEY,
			data: JSON.stringify(slim),
			fetchedAt: Date.now()
		})
		.onConflictDoUpdate({
			target: modelsCache.id,
			set: {
				data: JSON.stringify(slim),
				fetchedAt: Date.now()
			}
		});

	return slim;
}

const modelsQuerySchema = z
	.object({
		search: z.string().optional(),
		modality: z.string().optional(),
		capability: z.string().optional()
	})
	.optional();

export const getModels = query(modelsQuerySchema, async (filters) => {
	let models = await fetchAndCacheModels();

	if (filters?.search) {
		const q = filters.search.toLowerCase();
		models = models.filter(
			(m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
		);
	}

	if (filters?.modality) {
		models = models.filter(
			(m) =>
				m.input_modalities?.includes(filters.modality!) ||
				m.output_modalities?.includes(filters.modality!)
		);
	}

	if (filters?.capability) {
		models = models.filter((m) => m.supported_parameters?.includes(filters.capability!));
	}

	return models;
});
