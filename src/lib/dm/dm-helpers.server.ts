// DM Helpers — Server-side utility functions (non-remote)
import { db, dmCampaign, dmSession, dmConsequence } from '$lib/shared/db';
import { desc, eq } from 'drizzle-orm';

/** Build full campaign context string for system prompt injection */
export async function getCampaignContext(campaignId: string): Promise<string> {
	const campaign = await db.query.dmCampaign.findFirst({
		where: eq(dmCampaign.id, campaignId),
		with: {
			factions: true,
			consequences: { orderBy: [desc(dmConsequence.createdAt)], limit: 20 },
			quests: true,
			items: true,
			npcs: true,
			partyMembers: true,
			sessions: { orderBy: [desc(dmSession.sessionNumber)], limit: 5 }
		}
	});

	if (!campaign) return '';

	const parts: string[] = [];

	parts.push(`# Campaign: ${campaign.name}`);
	if (campaign.description) parts.push(campaign.description);

	// Party
	if (campaign.partyMembers.length > 0) {
		parts.push('\n## Party');
		for (const m of campaign.partyMembers) {
			parts.push(
				`- **${m.characterName}** (${m.race} ${m.class} Lv${m.level}, Player: ${m.playerName})`
			);
			if (m.backstoryHooks) parts.push(`  Backstory Hooks: ${m.backstoryHooks}`);
			if (m.notableItems !== '[]') parts.push(`  Notable Items: ${m.notableItems}`);
			if (m.relationships) parts.push(`  Relationships: ${m.relationships}`);
		}
	}

	// Factions
	if (campaign.factions.length > 0) {
		parts.push('\n## Faction Standings');
		for (const f of campaign.factions) {
			let label = 'Neutral';
			try {
				const thresholds = JSON.parse(f.thresholdNotes) as Array<{
					at: number;
					label: string;
					effects: string;
				}>;
				const sorted = thresholds.sort((a, b) => b.at - a.at);
				for (const t of sorted) {
					if (f.reputation >= t.at) {
						label = t.label;
						break;
					}
				}
			} catch {
				/* use default */
			}
			parts.push(`- **${f.name}** [${f.reputation}/100]: ${label}`);
			if (f.description) parts.push(`  ${f.description}`);
		}
	}

	// Active Quests
	const activeQuests = campaign.quests.filter((q) => q.status === 'active');
	if (activeQuests.length > 0) {
		parts.push('\n## Active Quests');
		const deadlines = activeQuests.filter((q) => q.category === 'hard_deadline');
		const leads = activeQuests.filter((q) => q.category === 'active_lead');
		const rumors = activeQuests.filter((q) => q.category === 'rumor');
		const side = activeQuests.filter((q) => q.category === 'side_quest');

		if (deadlines.length > 0) {
			parts.push('### Hard Deadlines');
			for (const q of deadlines) {
				parts.push(
					`- **${q.title}** [${q.urgency.toUpperCase()}]${q.deadline ? ` — ${q.deadline}` : ''}`
				);
				if (q.description) parts.push(`  ${q.description}`);
			}
		}
		if (leads.length > 0) {
			parts.push('### Active Leads');
			for (const q of leads) {
				parts.push(`- **${q.title}** [${q.urgency}]: ${q.description || ''}`);
			}
		}
		if (rumors.length > 0) {
			parts.push('### Rumors');
			for (const q of rumors) parts.push(`- ${q.title}: ${q.description || ''}`);
		}
		if (side.length > 0) {
			parts.push('### Side Quests');
			for (const q of side) parts.push(`- ${q.title}: ${q.description || ''}`);
		}
	}

	// Unresolved Consequences
	const unresolvedConsequences = campaign.consequences.filter((c) => {
		try {
			const results = JSON.parse(c.results) as Array<{ resolved?: boolean }>;
			return results.some((r) => !r.resolved);
		} catch {
			return true;
		}
	});
	if (unresolvedConsequences.length > 0) {
		parts.push('\n## Unresolved Consequences (Butterfly Effect)');
		for (const c of unresolvedConsequences.slice(0, 10)) {
			parts.push(`- **Action**: ${c.action}`);
			try {
				const results = JSON.parse(c.results) as Array<{
					description: string;
					affectedEntity?: string;
					resolved?: boolean;
				}>;
				for (const r of results.filter((r) => !r.resolved)) {
					parts.push(
						`  → ${r.description}${r.affectedEntity ? ` (affects: ${r.affectedEntity})` : ''}`
					);
				}
			} catch {
				/* skip */
			}
		}
	}

	// NPCs (alive, with stance info)
	const aliveNpcs = campaign.npcs.filter((n) => n.alive);
	if (aliveNpcs.length > 0) {
		parts.push('\n## Known NPCs');
		for (const n of aliveNpcs) {
			const tags = n.statusTags !== '[]' ? ` [${JSON.parse(n.statusTags).join(', ')}]` : '';
			parts.push(`- **${n.name}** (${n.race || 'Unknown'}) — Stance: ${n.stance}${tags}`);
			if (n.location) parts.push(`  Location: ${n.location}`);
			if (n.voice) parts.push(`  Voice: ${n.voice}`);
			if (n.temperament) parts.push(`  Temperament: ${n.temperament}`);
			if (n.secrets) parts.push(`  [SECRET] ${n.secrets}`);
			if (n.rumorPool !== '[]') {
				try {
					const rumors = JSON.parse(n.rumorPool) as string[];
					if (rumors.length > 0) parts.push(`  Rumor Pool: ${rumors.join('; ')}`);
				} catch {
					/* skip */
				}
			}
			if (n.factionId) {
				const faction = campaign.factions.find((f) => f.id === n.factionId);
				if (faction) parts.push(`  Faction: ${faction.name} (Rep: ${faction.reputation})`);
			}
		}
	}

	// Items (quest-givers and notable)
	const notableItems = campaign.items.filter(
		(i) => i.isQuestGiver || i.narrativeProperties || i.origin
	);
	if (notableItems.length > 0) {
		parts.push('\n## Notable Items');
		for (const i of notableItems) {
			parts.push(
				`- **${i.name}**${i.origin ? ` (${i.origin})` : ''}${i.currentHolder ? ` — Held by: ${i.currentHolder}` : ''}`
			);
			if (i.narrativeProperties) parts.push(`  Narrative: ${i.narrativeProperties}`);
			if (i.isQuestGiver && i.questHooks !== '[]') {
				try {
					const hooks = JSON.parse(i.questHooks) as string[];
					parts.push(`  Quest Hooks: ${hooks.join('; ')}`);
				} catch {
					/* skip */
				}
			}
		}
	}

	// Recent Session Recaps
	const completedSessions = campaign.sessions.filter((s) => s.status === 'completed' && s.dmRecap);
	if (completedSessions.length > 0) {
		parts.push('\n## Recent Session Recaps (DM View)');
		for (const s of completedSessions.slice(0, 3)) {
			parts.push(`### Session ${s.sessionNumber}: ${s.title}`);
			parts.push(s.dmRecap || '');
		}
	}

	return parts.join('\n');
}
