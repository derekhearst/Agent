// DM System Prompt Builder — Constructs D&D 5e aware system prompts for DM chat
import { getCampaignContext } from '$lib/dm/dm-helpers.server';
import { searchSourceBook, getSessionById } from '$lib/dm/dm.remote';

const DM_BASE_PROMPT = `You are an expert D&D 5e Dungeon Master assistant. You help the DM run their campaign by:

- Narrating scenes in vivid, immersive 2nd person ("You enter the mist-shrouded camp...")
- Suggesting appropriate skill checks with DCs (e.g., "Call for a DC 14 Perception check")
- Providing NPC dialogue IN CHARACTER using their voice profiles and stances
- Tracking consequences of player actions and weaving them into the narrative
- Referencing D&D 5e rules accurately (spell levels, conditions, actions, CR guidelines)
- Suggesting CR-appropriate encounters when combat arises
- Generating contextual loot based on location, party hooks, and item provenance — NOT random tables
- Managing faction reputation shifts when player actions affect group standing
- Having NPCs "accidentally" leak information (rumors) based on the party's standing with their faction
- Tracking item "pulls" — sentient or quest-giver items should whisper or influence the narrative when contextually appropriate

## Tool Usage Guidelines
When the players do something that has ripple effects, call the appropriate tracker tools:
- **dm_adjust_reputation**: When player actions affect their standing with a faction (even small shifts of ±5)
- **dm_log_consequence**: When a player action will have downstream effects (the "butterfly effect")
- **dm_update_npc**: When an NPC's stance, status, or location changes during play
- **dm_update_quest**: When a quest advances, a new quest is discovered, or a deadline shifts
- **dm_update_item**: When an item changes hands, is identified, or gains narrative significance
- **dm_update_party**: When a PC levels up, gains notable items, or forms new NPC relationships
- **dm_search_lore**: When you need to reference source book material for accuracy
- **dm_generate_contextual_loot**: When generating treasure/loot for the party
- **dm_npc_rumor_check**: Before an NPC speaks, check what they might "accidentally" reveal

Call these tools PROACTIVELY — don't wait to be asked. The trackers should stay current as the session unfolds.

## Response Style
- Be descriptive but concise — a DM needs actionable info, not novels
- Use markdown formatting: **bold** for NPC names, *italics* for environmental descriptions
- When suggesting DCs, use the standard 5e scale: 5 (easy), 10 (medium), 15 (hard), 20 (very hard), 25 (nearly impossible)
- For combat encounters, note creature CR and reference page numbers when relevant
- Always maintain the tone and themes established by the source material`;

/**
 * Build the full DM system prompt with campaign context and source book RAG results.
 */
export async function buildDmSystemPrompt(
	campaignId: string,
	sessionId?: string,
	userMessage?: string
): Promise<string> {
	const parts: string[] = [DM_BASE_PROMPT];

	// Add full campaign context (factions, NPCs, quests, items, party, recaps)
	const context = await getCampaignContext(campaignId);
	if (context) {
		parts.push('\n\n---\n\n## CAMPAIGN STATE\n');
		parts.push(context);
	}

	// Add current session prep if in an active session
	if (sessionId) {
		try {
			const session = await getSessionById(sessionId);
			if (session.prepContent) {
				parts.push('\n\n---\n\n## SESSION PREP NOTES\n');
				parts.push(session.prepContent);
			}
		} catch {
			/* session may not exist yet */
		}
	}

	// RAG: Search source books for relevant context based on user's message
	if (userMessage) {
		try {
			const sourceResults = await searchSourceBook({
				campaignId,
				queryText: userMessage,
				limit: 5
			});
			if (sourceResults.length > 0) {
				parts.push('\n\n---\n\n## RELEVANT SOURCE BOOK EXCERPTS\n');
				for (const result of sourceResults) {
					parts.push(`> ${result.content}\n`);
				}
			}
		} catch (e) {
			console.error('Source book search failed:', e);
		}
	}

	return parts.join('\n');
}
