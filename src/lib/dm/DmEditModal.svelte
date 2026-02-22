<script lang="ts">
	import { Pop } from '$lib/dm/pop';

	type EntityType = 'npc' | 'quest' | 'item' | 'party' | 'faction';

	interface Props {
		open: boolean;
		entityType: EntityType;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		entity: Record<string, any> | null;
		campaignId: string;
		factions?: Array<{ id: string; name: string }>;
		onSave: (data: Record<string, unknown>) => Promise<void>;
		onDelete?: (id: string) => Promise<void>;
		onClose: () => void;
	}

	let {
		open,
		entityType,
		entity,
		campaignId,
		factions = [],
		onSave,
		onDelete,
		onClose
	}: Props = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let form = $state<Record<string, any>>({});
	let isSaving = $state(false);
	let isDeleting = $state(false);

	$effect(() => {
		if (entity && open) {
			form = { ...entity };
		} else if (open) {
			form = getDefaults(entityType);
		}
	});

	function getDefaults(type: EntityType): Record<string, unknown> {
		switch (type) {
			case 'npc':
				return {
					name: '',
					race: '',
					description: '',
					location: '',
					voice: '',
					temperament: '',
					stance: 'Neutral',
					statusTags: '[]',
					secrets: '',
					rumorPool: '[]',
					factionId: null,
					alive: true,
					notes: ''
				};
			case 'quest':
				return {
					title: '',
					description: '',
					category: 'active_lead',
					deadline: '',
					urgency: 'medium',
					status: 'active',
					notes: ''
				};
			case 'item':
				return {
					name: '',
					description: '',
					mechanicalProperties: '',
					narrativeProperties: '',
					origin: '',
					currentHolder: '',
					isQuestGiver: false,
					questHooks: '[]',
					tags: '[]',
					notes: ''
				};
			case 'party':
				return {
					playerName: '',
					characterName: '',
					race: '',
					class: '',
					level: 1,
					backstoryHooks: '',
					notableItems: '[]',
					relationships: '',
					notes: ''
				};
			case 'faction':
				return {
					name: '',
					description: '',
					reputation: 0,
					thresholdNotes: '[]',
					notes: ''
				};
		}
	}

	function title(): string {
		const isNew = !entity;
		switch (entityType) {
			case 'npc':
				return isNew ? 'Add NPC' : `Edit NPC: ${entity?.name}`;
			case 'quest':
				return isNew ? 'Add Quest' : `Edit Quest: ${entity?.title}`;
			case 'item':
				return isNew ? 'Add Item' : `Edit Item: ${entity?.name}`;
			case 'party':
				return isNew ? 'Add Party Member' : `Edit: ${entity?.characterName}`;
			case 'faction':
				return isNew ? 'Add Faction' : `Edit Faction: ${entity?.name}`;
		}
	}

	async function handleSave() {
		isSaving = true;
		try {
			const data: Record<string, unknown> = { campaignId };
			if (entity?.id) data.id = entity.id;

			// Copy all form fields
			for (const [key, val] of Object.entries(form)) {
				if (key === 'id' || key === 'campaignId' || key === 'createdAt' || key === 'updatedAt')
					continue;
				data[key] = val;
			}

			await onSave(data);
			Pop.success(entity ? 'Updated!' : 'Created!');
			onClose();
		} catch (err) {
			Pop.error('Save failed');
			console.error(err);
		} finally {
			isSaving = false;
		}
	}

	async function handleDelete() {
		if (!entity?.id || !onDelete) return;
		const confirmed = await Pop.confirm(`Delete this ${entityType}? This cannot be undone.`);
		if (!confirmed) return;
		isDeleting = true;
		try {
			await onDelete(entity.id);
			Pop.success('Deleted');
			onClose();
		} catch (err) {
			Pop.error('Delete failed');
			console.error(err);
		} finally {
			isDeleting = false;
		}
	}

	// Tag/array helpers
	let newTag = $state('');

	function parseTags(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	function addTag(field: string) {
		if (!newTag.trim()) return;
		const tags = parseTags(form[field] || '[]');
		tags.push(newTag.trim());
		form[field] = JSON.stringify(tags);
		newTag = '';
	}

	function removeTag(field: string, index: number) {
		const tags = parseTags(form[field] || '[]');
		tags.splice(index, 1);
		form[field] = JSON.stringify(tags);
	}
</script>

{#if open}
	<div class="modal-open modal">
		<div class="modal-box max-h-[85vh] max-w-2xl overflow-y-auto">
			<button class="btn absolute top-4 right-4 btn-circle btn-ghost btn-sm" onclick={onClose}>
				✕
			</button>

			<h3 class="text-lg font-bold">{title()}</h3>

			<form
				class="mt-4 flex flex-col gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
			>
				{#if entityType === 'npc'}
					<div class="grid grid-cols-2 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Name *</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.name}
								required
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Race</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.race}
								placeholder="e.g. Half-Elf"
							/>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Description</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.description}
							placeholder="Appearance, mannerisms..."
						></textarea>
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Location</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.location}
								placeholder="e.g. Waterdeep Docks"
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Faction</span>
							<select class="select-bordered select select-sm" bind:value={form.factionId}>
								<option value={null}>None</option>
								{#each factions as f (f.id)}
									<option value={f.id}>{f.name}</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="grid grid-cols-3 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Voice</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.voice}
								placeholder="Gruff, whispery..."
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Temperament</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.temperament}
								placeholder="Jovial, paranoid..."
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Stance</span>
							<select class="select-bordered select select-sm" bind:value={form.stance}>
								<option value="Allied">Allied</option>
								<option value="Friendly">Friendly</option>
								<option value="Neutral">Neutral</option>
								<option value="Suspicious">Suspicious</option>
								<option value="Hostile">Hostile</option>
							</select>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Secrets (DM-only)</span>
						<textarea
							class="textarea-bordered textarea bg-warning/5 textarea-sm"
							bind:value={form.secrets}
							placeholder="Hidden motivations, plot twists..."
						></textarea>
					</label>
					<!-- Status Tags -->
					<div class="form-control">
						<span class="label-text text-xs">Status Tags</span>
						<div class="flex flex-wrap gap-1">
							{#each parseTags(form.statusTags || '[]') as tag, i (i)}
								<span class="badge gap-1 badge-outline badge-sm">
									{tag}
									<button type="button" class="text-xs" onclick={() => removeTag('statusTags', i)}
										>✕</button
									>
								</span>
							{/each}
						</div>
						<div class="mt-1 flex gap-1">
							<input
								type="text"
								class="input-bordered input input-xs flex-1"
								bind:value={newTag}
								placeholder="Add tag..."
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag('statusTags'))}
							/>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={() => addTag('statusTags')}>+</button
							>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={form.alive} />
						<span class="text-sm">Alive</span>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Notes</span>
						<textarea class="textarea-bordered textarea textarea-sm" bind:value={form.notes}
						></textarea>
					</label>
				{:else if entityType === 'quest'}
					<label class="form-control">
						<span class="label-text text-xs">Title *</span>
						<input
							type="text"
							class="input-bordered input input-sm"
							bind:value={form.title}
							required
						/>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Description</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.description}
							placeholder="Quest details, objectives..."
						></textarea>
					</label>
					<div class="grid grid-cols-3 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Category</span>
							<select class="select-bordered select select-sm" bind:value={form.category}>
								<option value="active_lead">Active Lead</option>
								<option value="hard_deadline">Hard Deadline</option>
								<option value="rumor">Rumor</option>
								<option value="side_quest">Side Quest</option>
							</select>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Urgency</span>
							<select class="select-bordered select select-sm" bind:value={form.urgency}>
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
								<option value="critical">Critical</option>
							</select>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Status</span>
							<select class="select-bordered select select-sm" bind:value={form.status}>
								<option value="active">Active</option>
								<option value="completed">Completed</option>
								<option value="failed">Failed</option>
								<option value="hidden">Hidden</option>
							</select>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Deadline</span>
						<input
							type="text"
							class="input-bordered input input-sm"
							bind:value={form.deadline}
							placeholder="e.g. Before the full moon, 3 days"
						/>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Notes</span>
						<textarea class="textarea-bordered textarea textarea-sm" bind:value={form.notes}
						></textarea>
					</label>
				{:else if entityType === 'item'}
					<div class="grid grid-cols-2 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Name *</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.name}
								required
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Current Holder</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.currentHolder}
								placeholder="Character or location"
							/>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Description</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.description}
							placeholder="What it looks like, history..."
						></textarea>
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">⚔️ Mechanical Properties</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.mechanicalProperties}
								placeholder="+1 to hit, 1d8 radiant..."
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">📖 Narrative Properties</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.narrativeProperties}
								placeholder="Glows near undead..."
							/>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Origin / Provenance</span>
						<input
							type="text"
							class="input-bordered input input-sm"
							bind:value={form.origin}
							placeholder="Forged by the Dwarves of Mithral Hall"
						/>
					</label>
					<div class="flex items-center gap-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={form.isQuestGiver} />
						<span class="text-sm">Quest-Giver Item</span>
					</div>
					<!-- Tags -->
					<div class="form-control">
						<span class="label-text text-xs">Tags</span>
						<div class="flex flex-wrap gap-1">
							{#each parseTags(form.tags || '[]') as tag, i (i)}
								<span class="badge gap-1 badge-outline badge-sm">
									{tag}
									<button type="button" class="text-xs" onclick={() => removeTag('tags', i)}
										>✕</button
									>
								</span>
							{/each}
						</div>
						<div class="mt-1 flex gap-1">
							<input
								type="text"
								class="input-bordered input input-xs flex-1"
								bind:value={newTag}
								placeholder="Add tag..."
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag('tags'))}
							/>
							<button type="button" class="btn btn-ghost btn-xs" onclick={() => addTag('tags')}
								>+</button
							>
						</div>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Notes</span>
						<textarea class="textarea-bordered textarea textarea-sm" bind:value={form.notes}
						></textarea>
					</label>
				{:else if entityType === 'party'}
					<div class="grid grid-cols-2 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Character Name *</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.characterName}
								required
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Player Name *</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.playerName}
								required
							/>
						</label>
					</div>
					<div class="grid grid-cols-3 gap-3">
						<label class="form-control">
							<span class="label-text text-xs">Race</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.race}
								placeholder="e.g. Tiefling"
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Class</span>
							<input
								type="text"
								class="input-bordered input input-sm"
								bind:value={form.class}
								placeholder="e.g. Warlock"
							/>
						</label>
						<label class="form-control">
							<span class="label-text text-xs">Level</span>
							<input
								type="number"
								class="input-bordered input input-sm"
								bind:value={form.level}
								min="1"
								max="20"
							/>
						</label>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Backstory Hooks</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.backstoryHooks}
							placeholder="Plot threads from backstory..."
						></textarea>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Relationships</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.relationships}
							placeholder="Relations with NPCs, factions..."
						></textarea>
					</label>
					<!-- Notable Items -->
					<div class="form-control">
						<span class="label-text text-xs">Notable Items</span>
						<div class="flex flex-wrap gap-1">
							{#each parseTags(form.notableItems || '[]') as item, i (i)}
								<span class="badge gap-1 badge-ghost badge-sm">
									{item}
									<button type="button" class="text-xs" onclick={() => removeTag('notableItems', i)}
										>✕</button
									>
								</span>
							{/each}
						</div>
						<div class="mt-1 flex gap-1">
							<input
								type="text"
								class="input-bordered input input-xs flex-1"
								bind:value={newTag}
								placeholder="Add item..."
								onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag('notableItems'))}
							/>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={() => addTag('notableItems')}>+</button
							>
						</div>
					</div>
					<label class="form-control">
						<span class="label-text text-xs">Notes</span>
						<textarea class="textarea-bordered textarea textarea-sm" bind:value={form.notes}
						></textarea>
					</label>
				{:else if entityType === 'faction'}
					<label class="form-control">
						<span class="label-text text-xs">Name *</span>
						<input
							type="text"
							class="input-bordered input input-sm"
							bind:value={form.name}
							required
						/>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Description</span>
						<textarea
							class="textarea-bordered textarea textarea-sm"
							bind:value={form.description}
							placeholder="Who they are, what they want..."
						></textarea>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Reputation ({form.reputation ?? 0})</span>
						<input
							type="range"
							class="range range-sm"
							min="-100"
							max="100"
							bind:value={form.reputation}
						/>
						<div class="flex justify-between text-xs opacity-40">
							<span>-100 Enemy</span>
							<span>0 Neutral</span>
							<span>+100 Allied</span>
						</div>
					</label>
					<label class="form-control">
						<span class="label-text text-xs">Notes</span>
						<textarea class="textarea-bordered textarea textarea-sm" bind:value={form.notes}
						></textarea>
					</label>
				{/if}

				<!-- Actions -->
				<div class="modal-action">
					{#if entity && onDelete}
						<button
							type="button"
							class="btn mr-auto btn-sm btn-error"
							disabled={isDeleting}
							onclick={handleDelete}
						>
							{isDeleting ? 'Deleting...' : 'Delete'}
						</button>
					{/if}
					<button type="button" class="btn btn-ghost btn-sm" onclick={onClose}>Cancel</button>
					<button type="submit" class="btn btn-sm btn-primary" disabled={isSaving}>
						{isSaving ? 'Saving...' : entity ? 'Save Changes' : 'Create'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" role="presentation" onclick={onClose}></div>
	</div>
{/if}
