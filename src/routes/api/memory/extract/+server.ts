// POST /api/memory/extract — deep extraction from a chat session via /remember
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { message } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { storeChunks, type MemoryType } from '$lib/server/vector-store';
import { writeMemoryFile } from '$lib/server/memory-files';
import { env } from '$env/dynamic/private';

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the following conversation and extract ALL important information worth remembering long-term. This includes:

- User preferences and habits
- Technical decisions and architectural choices
- Key facts about the user or their projects
- Important decisions made during the conversation
- Useful knowledge or insights discussed
- Recipes, plans, or other structured information
- Action items or future tasks mentioned

Return a JSON array of objects with this structure:
[
  {
    "content": "The extracted fact or knowledge",
    "type": "knowledge" | "note",
    "suggestedPath": "optional/path/to/file.md (only for structured knowledge that deserves its own file)"
  }
]

Be thorough but avoid extracting trivial pleasantries. Focus on information that would be useful in future conversations. Return ONLY valid JSON, no markdown code fences.`;

export const POST: RequestHandler = async ({ request }) => {
	const { sessionId } = await request.json();

	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	try {
		// Load all messages from the session
		const messages = await db.query.message.findMany({
			where: eq(message.sessionId, sessionId),
			orderBy: (msg, { asc }) => [asc(msg.createdAt)]
		});

		if (messages.length === 0) {
			return json({ error: 'No messages found in session' }, { status: 404 });
		}

		// Format conversation for extraction
		const conversationText = messages
			.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
			.join('\n\n');

		// Call LLM for extraction
		const apiKey = env.OPENROUTER_API_KEY;
		if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

		const extractionResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'openrouter/auto',
				messages: [
					{ role: 'system', content: EXTRACTION_PROMPT },
					{ role: 'user', content: conversationText }
				],
				stream: false
			})
		});

		if (!extractionResponse.ok) {
			throw new Error(`Extraction LLM call failed: ${extractionResponse.status}`);
		}

		const completion = await extractionResponse.json();
		const rawContent = completion.choices?.[0]?.message?.content || '[]';

		// Parse extracted items
		let extracted: Array<{
			content: string;
			type: MemoryType;
			suggestedPath?: string;
		}>;

		try {
			// Handle potential markdown code fences
			const cleaned = rawContent.replace(/```json\n?|\n?```/g, '').trim();
			extracted = JSON.parse(cleaned);
		} catch {
			console.error('Failed to parse extraction result:', rawContent);
			return json({ error: 'Failed to parse extracted memories' }, { status: 500 });
		}

		if (!Array.isArray(extracted) || extracted.length === 0) {
			return json({ extracted: [], chunksStored: 0, filesCreated: 0 });
		}

		// Store chunks in vector store
		const chunkData = extracted.map((item) => ({
			content: item.content,
			meta: {
				sessionId,
				type: item.type || 'knowledge',
				source: `Extracted from session ${sessionId}`
			}
		}));

		const ids = await storeChunks(chunkData);

		// Create markdown files for items with suggested paths
		let filesCreated = 0;
		for (const item of extracted) {
			if (item.suggestedPath) {
				try {
					const path = item.suggestedPath.endsWith('.md')
						? item.suggestedPath
						: `${item.suggestedPath}.md`;
					await writeMemoryFile(
						path,
						`# ${item.suggestedPath.split('/').pop()?.replace('.md', '') || 'Note'}\n\n${item.content}\n`
					);
					filesCreated++;
				} catch (err) {
					console.error('Failed to create memory file:', err);
				}
			}
		}

		return json({
			extracted: extracted.map((e) => e.content),
			chunksStored: ids.length,
			filesCreated,
			message: `Extracted ${ids.length} memories${filesCreated > 0 ? ` and created ${filesCreated} note files` : ''}`
		});
	} catch (error) {
		console.error('Memory extraction error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Extraction failed' },
			{ status: 500 }
		);
	}
};
