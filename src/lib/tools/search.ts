// Web Search Tool — uses self-hosted SearXNG instance
import { env } from '$env/dynamic/private';
import type { ToolHandler, ToolExecuteResult } from '$lib/tools/tools';

interface SearchResult {
	title: string;
	url: string;
	content: string;
}

const FALLBACK_URL = 'http://192.168.0.2:8082';

async function searchWeb(query: string): Promise<ToolExecuteResult> {
	const searxngUrl = env.SEARXNG_URL || FALLBACK_URL;

	try {
		const url = new URL(`${searxngUrl}/search`);
		url.searchParams.append('q', query);
		url.searchParams.append('format', 'json');
		url.searchParams.append('engines', 'google,bing');

		console.log(`🔍 Agent Searching: "${query}"`);

		const response = await fetch(url.toString());

		if (!response.ok) {
			throw new Error(`Search failed: ${response.statusText}`);
		}

		const data = await response.json();

		const results: SearchResult[] = data.results.slice(0, 5).map((r: Record<string, string>) => ({
			title: r.title,
			url: r.url,
			content: r.content
		}));

		if (results.length === 0) {
			return {
				content: 'No results found.',
				meta: { sources: [] }
			};
		}

		const content = results
			.map((r) => `### ${r.title}\nSource: ${r.url}\n${r.content}\n`)
			.join('\n---\n');

		const sources = results.map((r) => ({ title: r.title, url: r.url }));

		return { content, meta: { sources } };
	} catch (error) {
		console.error('Search Error:', error);
		return {
			content: 'Error: Could not search the web. The search engine might be down.',
			meta: { sources: [] }
		};
	}
}

export const searchWebTool: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'search_web',
			description:
				'Search the web for current information. Use this when the user asks about recent events, news, current data, real-time information, or anything you are unsure about and could benefit from up-to-date web results. Always cite sources from the search results in your response.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query to look up on the web'
					}
				},
				required: ['query']
			}
		}
	},
	execute: async (args) => {
		const query = args.query as string;
		if (!query) return { content: 'Error: No search query provided.' };
		return await searchWeb(query);
	}
};
