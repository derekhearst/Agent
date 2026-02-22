// DM-specific tool handlers — used by the DM chat endpoint during sessions
import type { ToolDefinition, ToolHandler, ToolExecuteResult } from '$lib/tools/tools';
import {
	adjustReputation,
	logConsequence,
	updateNpc,
	createNpc,
	updateQuest,
	createQuest,
	updateItem,
	createItem,
	updatePartyMember,
	searchSourceBook,
	getCampaignContext,
	getNpcs,
	getFactions
} from '$lib/dm/dm.remote';
import { chatSimple } from '$lib/chat/chat';
import type { ChatMessage } from '$lib/chat/chat';

// ============== TOOL DEFINITIONS ==============

/** Get all DM-specific tool definitions (OpenRouter-compatible format) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getDmToolDefinitions(campaignId: string): ToolDefinition[] {
	return dmToolHandlers.map((h) => h.definition);
}

/** Execute a DM tool by name */
export async function executeDmTool(
	name: string,
	args: Record<string, unknown>,
	campaignId: string,
	sessionId?: string
): Promise<ToolExecuteResult> {
	// Inject campaignId into args so tools don't need it from the model
	const enrichedArgs = { ...args, campaignId, sessionId };

	const handler = dmToolMap.get(name);
	if (!handler) {
		return { content: `Error: Unknown DM tool "${name}"` };
	}
	try {
		return await handler.execute(enrichedArgs);
	} catch (error) {
		console.error(`DM Tool "${name}" error:`, error);
		return {
			content: `Error executing DM tool "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`
		};
	}
}

/** Check if a tool name is a DM tool */
export function isDmTool(name: string): boolean {
	return name.startsWith('dm_');
}

// ============== TOOL HANDLERS ==============

const dmSearchLore: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_search_lore',
			description:
				'Search the campaign source books for specific lore, rules, locations, NPCs, or encounters. Use this when you need accurate reference material from the adventure module.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'What to search for in the source books'
					}
				},
				required: ['query']
			}
		}
	},
	execute: async (args) => {
		const results = await searchSourceBook({
			campaignId: args.campaignId as string,
			queryText: args.query as string,
			limit: 5
		});

		if (results.length === 0) {
			return { content: 'No relevant source book entries found for that query.' };
		}

		const text = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');

		return { content: `Source Book Results:\n\n${text}` };
	}
};

const dmAdjustReputation: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_adjust_reputation',
			description:
				"Adjust a faction's reputation score based on player actions. Positive values improve standing, negative values worsen it. Scale: -100 to +100.",
			parameters: {
				type: 'object',
				properties: {
					faction_name: {
						type: 'string',
						description: 'Name of the faction to adjust'
					},
					delta: {
						type: 'number',
						description: 'How much to change reputation by (e.g., +10, -15)'
					},
					reason: {
						type: 'string',
						description: 'Why the reputation changed (player action that caused it)'
					}
				},
				required: ['faction_name', 'delta', 'reason']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		const factions = await getFactions(campaignId);
		const faction = factions.find(
			(f) => f.name.toLowerCase() === (args.faction_name as string).toLowerCase()
		);

		if (!faction) {
			return {
				content: `Faction "${args.faction_name}" not found. Create it first or check the name.`
			};
		}

		const updated = await adjustReputation({
			factionId: faction.id,
			campaignId,
			delta: args.delta as number,
			reason: args.reason as string
		});

		return {
			content: `Faction "${updated.name}" reputation adjusted by ${(args.delta as number) > 0 ? '+' : ''}${args.delta}: ${args.reason}. New reputation: ${updated.reputation}/100.`
		};
	}
};

const dmLogConsequence: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_log_consequence',
			description:
				'Log a player action and its downstream consequences in the Butterfly Effect tracker. Use this when players make choices that will ripple through the campaign.',
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						description: 'What the players did'
					},
					results: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								description: { type: 'string' },
								affectedEntity: { type: 'string' }
							},
							required: ['description']
						},
						description: 'The downstream consequences of this action'
					}
				},
				required: ['action', 'results']
			}
		}
	},
	execute: async (args) => {
		const results = (args.results as Array<{ description: string; affectedEntity?: string }>).map(
			(r) => ({ ...r, resolved: false })
		);

		await logConsequence({
			campaignId: args.campaignId as string,
			sessionId: args.sessionId as string | undefined,
			action: args.action as string,
			results: JSON.stringify(results)
		});

		return {
			content: `Butterfly Effect logged: "${args.action}" → ${results.length} consequence(s) recorded.`
		};
	}
};

const dmUpdateNpc: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_update_npc',
			description:
				"Create or update an NPC in the campaign tracker. Use when a new NPC is introduced or when an existing NPC's stance, location, status, or other details change.",
			parameters: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'NPC name' },
					race: { type: 'string', description: 'NPC race (e.g., Human, Elf, Vistani)' },
					description: { type: 'string', description: 'Brief description' },
					location: { type: 'string', description: 'Current location' },
					voice: { type: 'string', description: 'Speech patterns, dialect, verbal tics' },
					temperament: { type: 'string', description: 'Core personality' },
					stance: {
						type: 'string',
						description:
							'Current disposition toward party (Friendly, Neutral, Hostile, Fearful, Indebted, Scheming, etc.)'
					},
					status_tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Status tags like "Recovering", "Shamed", "Hiding", "Suspicious"'
					},
					secrets: { type: 'string', description: "What they know that the party doesn't" },
					rumors: {
						type: 'array',
						items: { type: 'string' },
						description: 'Things they might accidentally let slip based on party standing'
					},
					alive: { type: 'boolean', description: 'Whether the NPC is alive' }
				},
				required: ['name']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		const npcs = await getNpcs(campaignId);
		const existing = npcs.find((n) => n.name.toLowerCase() === (args.name as string).toLowerCase());

		const data: Record<string, unknown> = { campaignId };
		if (args.name) data.name = args.name;
		if (args.race) data.race = args.race;
		if (args.description) data.description = args.description;
		if (args.location) data.location = args.location;
		if (args.voice) data.voice = args.voice;
		if (args.temperament) data.temperament = args.temperament;
		if (args.stance) data.stance = args.stance;
		if (args.status_tags) data.statusTags = JSON.stringify(args.status_tags);
		if (args.secrets) data.secrets = args.secrets;
		if (args.rumors) data.rumorPool = JSON.stringify(args.rumors);
		if (args.alive !== undefined) data.alive = args.alive;

		if (existing) {
			data.id = existing.id;
			await updateNpc(data as Parameters<typeof updateNpc>[0]);
			return { content: `NPC "${args.name}" updated in tracker.` };
		} else {
			await createNpc(data as Parameters<typeof createNpc>[0]);
			return { content: `NPC "${args.name}" added to tracker.` };
		}
	}
};

const dmUpdateQuest: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_update_quest',
			description:
				'Create or update a quest in the campaign tracker. Use when a new quest/lead is discovered, a quest advances, or its status changes.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Quest title' },
					description: { type: 'string', description: 'Quest description' },
					category: {
						type: 'string',
						enum: ['active_lead', 'hard_deadline', 'rumor', 'side_quest'],
						description: 'Quest category'
					},
					deadline: {
						type: 'string',
						description: 'Deadline description (e.g., "3 days until the festival")'
					},
					urgency: {
						type: 'string',
						enum: ['low', 'medium', 'high', 'critical'],
						description: 'Urgency level'
					},
					status: {
						type: 'string',
						enum: ['active', 'completed', 'failed', 'hidden'],
						description: 'Quest status'
					},
					notes: { type: 'string', description: 'Additional DM notes' }
				},
				required: ['title']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		// Try to find existing quest by title
		const { db: dbInstance } = await import('$lib/shared/db');
		const { dmQuest } = await import('$lib/shared/db');
		const { eq } = await import('drizzle-orm');
		const quests = await dbInstance.query.dmQuest.findMany({
			where: eq(dmQuest.campaignId, campaignId)
		});
		const existing = quests.find(
			(q) => q.title.toLowerCase() === (args.title as string).toLowerCase()
		);

		if (existing) {
			const data: Record<string, unknown> = { id: existing.id, campaignId };
			if (args.title) data.title = args.title;
			if (args.description) data.description = args.description;
			if (args.category) data.category = args.category;
			if (args.deadline !== undefined) data.deadline = args.deadline;
			if (args.urgency) data.urgency = args.urgency;
			if (args.status) data.status = args.status;
			if (args.notes) data.notes = args.notes;
			await updateQuest(data as Parameters<typeof updateQuest>[0]);
			return {
				content: `Quest "${args.title}" updated. Status: ${args.status || existing.status}`
			};
		} else {
			await createQuest({
				campaignId,
				title: args.title as string,
				description: (args.description as string) || '',
				category:
					(args.category as 'active_lead' | 'hard_deadline' | 'rumor' | 'side_quest') ||
					'active_lead',
				deadline: args.deadline as string | undefined,
				urgency: (args.urgency as 'low' | 'medium' | 'high' | 'critical') || 'medium',
				status: (args.status as 'active' | 'completed' | 'failed' | 'hidden') || 'active',
				notes: args.notes as string | undefined
			});
			return { content: `New quest "${args.title}" added to tracker.` };
		}
	}
};

const dmUpdateItem: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_update_item',
			description:
				'Create or update an item in the campaign tracker. Use for quest-giver items, significant loot, or items that change hands.',
			parameters: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'Item name' },
					description: { type: 'string', description: 'Item description' },
					mechanical_properties: { type: 'string', description: 'Stats, gold value, rules text' },
					narrative_properties: { type: 'string', description: 'The "pull", flavor, mystique' },
					origin: {
						type: 'string',
						description: 'Provenance / legacy name (e.g., "Arabelle Reward from Luvash")'
					},
					current_holder: { type: 'string', description: 'Who currently holds the item' },
					is_quest_giver: { type: 'boolean', description: 'Whether this item drives plot forward' },
					quest_hooks: {
						type: 'array',
						items: { type: 'string' },
						description: 'Things this item whispers or drives players toward'
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Tags like "cursed", "sentient", "fey", "holy"'
					}
				},
				required: ['name']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		const { db: dbInstance, dmItem } = await import('$lib/shared/db');
		const { eq } = await import('drizzle-orm');
		const items = await dbInstance.query.dmItem.findMany({
			where: eq(dmItem.campaignId, campaignId)
		});
		const existing = items.find(
			(i) => i.name.toLowerCase() === (args.name as string).toLowerCase()
		);

		const data: Record<string, unknown> = { campaignId };
		if (args.name) data.name = args.name;
		if (args.description) data.description = args.description;
		if (args.mechanical_properties) data.mechanicalProperties = args.mechanical_properties;
		if (args.narrative_properties) data.narrativeProperties = args.narrative_properties;
		if (args.origin) data.origin = args.origin;
		if (args.current_holder !== undefined) data.currentHolder = args.current_holder;
		if (args.is_quest_giver !== undefined) data.isQuestGiver = args.is_quest_giver;
		if (args.quest_hooks) data.questHooks = JSON.stringify(args.quest_hooks);
		if (args.tags) data.tags = JSON.stringify(args.tags);

		if (existing) {
			data.id = existing.id;
			await updateItem(data as Parameters<typeof updateItem>[0]);
			return { content: `Item "${args.name}" updated in tracker.` };
		} else {
			await createItem(data as Parameters<typeof createItem>[0]);
			return { content: `Item "${args.name}" added to tracker.` };
		}
	}
};

const dmUpdateParty: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_update_party',
			description:
				"Update a party member's details (level, items, relationships). Use when PCs level up, gain notable items, or form new NPC relationships.",
			parameters: {
				type: 'object',
				properties: {
					character_name: { type: 'string', description: 'Character name to update' },
					level: { type: 'number', description: 'New level' },
					notable_items: {
						type: 'array',
						items: { type: 'string' },
						description: 'Updated list of notable items'
					},
					relationships: { type: 'string', description: 'Updated NPC relationship notes' },
					notes: { type: 'string', description: 'Additional notes' }
				},
				required: ['character_name']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		const { db: dbInstance, dmPartyMember } = await import('$lib/shared/db');
		const { eq } = await import('drizzle-orm');
		const members = await dbInstance.query.dmPartyMember.findMany({
			where: eq(dmPartyMember.campaignId, campaignId)
		});
		const existing = members.find(
			(m) => m.characterName.toLowerCase() === (args.character_name as string).toLowerCase()
		);

		if (!existing) {
			return {
				content: `Party member "${args.character_name}" not found. Add them in the Party tab first.`
			};
		}

		const data: Record<string, unknown> = { id: existing.id, campaignId };
		if (args.level) data.level = args.level;
		if (args.notable_items) data.notableItems = JSON.stringify(args.notable_items);
		if (args.relationships) data.relationships = args.relationships;
		if (args.notes) data.notes = args.notes;

		await updatePartyMember(data as Parameters<typeof updatePartyMember>[0]);
		return { content: `Party member "${args.character_name}" updated.` };
	}
};

const dmGetCampaignState: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_get_campaign_state',
			description:
				'Retrieve the full current state of the campaign (factions, quests, NPCs, items, party, consequences).',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},
	execute: async (args) => {
		const context = await getCampaignContext(args.campaignId as string);
		return { content: context || 'No campaign state available.' };
	}
};

const dmGetSessionRecaps: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_get_session_recaps',
			description: 'Fetch previous session recaps for continuity and reference.',
			parameters: {
				type: 'object',
				properties: {
					count: { type: 'number', description: 'Number of recent recaps to fetch (default: 3)' }
				},
				required: []
			}
		}
	},
	execute: async (args) => {
		const { db: dbInstance, dmSession } = await import('$lib/shared/db');
		const { eq, desc } = await import('drizzle-orm');
		const campaignId = args.campaignId as string;
		const limit = (args.count as number) || 3;

		const sessions = await dbInstance.query.dmSession.findMany({
			where: eq(dmSession.campaignId, campaignId),
			orderBy: [desc(dmSession.sessionNumber)],
			limit
		});

		const recaps = sessions
			.filter((s) => s.dmRecap)
			.map((s) => `## Session ${s.sessionNumber}: ${s.title}\n${s.dmRecap}`)
			.join('\n\n---\n\n');

		return { content: recaps || 'No previous session recaps available.' };
	}
};

const dmGenerateContextualLoot: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_generate_contextual_loot',
			description:
				'Generate thematic, contextual loot based on current location, party hooks, and campaign themes. NOT random table rolls.',
			parameters: {
				type: 'object',
				properties: {
					location: { type: 'string', description: 'Where the loot is found' },
					context: {
						type: 'string',
						description: 'Narrative context (e.g., "looting Vistani wagon", "dragon hoard")'
					},
					value_tier: {
						type: 'string',
						enum: ['trinket', 'minor', 'moderate', 'major', 'legendary'],
						description: 'Approximate value tier'
					}
				},
				required: ['location', 'context']
			}
		}
	},
	execute: async (args) => {
		const campaignState = await getCampaignContext(args.campaignId as string);
		const messages: ChatMessage[] = [
			{
				role: 'system',
				content: `You are a D&D 5e loot designer. Generate 2-4 items that are thematically appropriate for the location and context. Each item should have:
- A name (with a legacy/provenance name if applicable)
- Brief description
- Mechanical properties (gold value, stats if magical)
- Narrative hooks (how might this item connect to campaign themes?)

Consider the party's backstory hooks and active quests when designing items. Make items that ADVANCE THE STORY, not just fill inventory.

Campaign State:
${campaignState}`
			},
			{
				role: 'user',
				content: `Generate contextual loot for: ${args.context}\nLocation: ${args.location}\nValue tier: ${args.value_tier || 'moderate'}`
			}
		];

		try {
			const result = await chatSimple(messages);
			return {
				content: (result.choices?.[0]?.message?.content as string) || 'Failed to generate loot.'
			};
		} catch {
			return { content: 'Failed to generate contextual loot.' };
		}
	}
};

const dmNpcRumorCheck: ToolHandler = {
	definition: {
		type: 'function',
		function: {
			name: 'dm_npc_rumor_check',
			description:
				'Check what information an NPC might "accidentally" reveal based on the party\'s faction standing and the NPC\'s rumor pool.',
			parameters: {
				type: 'object',
				properties: {
					npc_name: { type: 'string', description: 'Name of the NPC to check' }
				},
				required: ['npc_name']
			}
		}
	},
	execute: async (args) => {
		const campaignId = args.campaignId as string;
		const npcs = await getNpcs(campaignId);
		const npc = npcs.find((n) => n.name.toLowerCase() === (args.npc_name as string).toLowerCase());

		if (!npc) {
			return { content: `NPC "${args.npc_name}" not found in tracker.` };
		}

		let rumorPool: string[] = [];
		try {
			rumorPool = JSON.parse(npc.rumorPool);
		} catch {
			/* no rumors */
		}

		if (rumorPool.length === 0) {
			return { content: `${npc.name} has no rumors in their pool. They speak carefully.` };
		}

		// Check faction standing for the NPC's faction
		let factionContext = '';
		if (npc.factionId) {
			const factions = await getFactions(campaignId);
			const faction = factions.find((f) => f.id === npc.factionId);
			if (faction) {
				factionContext = `\nFaction: ${faction.name} (Reputation: ${faction.reputation}/100)`;
				if (faction.reputation > 25) {
					factionContext += '\nParty has GOOD standing — NPC is more willing to share.';
				} else if (faction.reputation < -25) {
					factionContext += '\nParty has POOR standing — NPC guards information carefully.';
				}
			}
		}

		const statusTags = npc.statusTags !== '[]' ? ` Status: ${npc.statusTags}` : '';

		return {
			content: `NPC Rumor Check for ${npc.name}:
Stance toward party: ${npc.stance}${statusTags}${factionContext}
Voice: ${npc.voice || 'No voice notes'}
Temperament: ${npc.temperament || 'No temperament notes'}

Available rumors to "accidentally" let slip:
${rumorPool.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Secrets (DM only, do NOT reveal directly):
${npc.secrets || 'None recorded'}`
		};
	}
};

// ============== REGISTRY ==============

const dmToolHandlers: ToolHandler[] = [
	dmSearchLore,
	dmAdjustReputation,
	dmLogConsequence,
	dmUpdateNpc,
	dmUpdateQuest,
	dmUpdateItem,
	dmUpdateParty,
	dmGetCampaignState,
	dmGetSessionRecaps,
	dmGenerateContextualLoot,
	dmNpcRumorCheck
];

const dmToolMap = new Map<string, ToolHandler>(
	dmToolHandlers.map((h) => [h.definition.function.name, h])
);
