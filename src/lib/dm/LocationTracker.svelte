<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import { createLocation, updateLocation, deleteLocation } from '$lib/dm/dm.remote';

	interface Location {
		id: string;
		name: string;
		locationType: string;
		description: string;
		parentLocationId?: string | null;
		linkedNpcIds: string;
		linkedQuestIds: string;
		tags: string;
		notes?: string | null;
	}

	interface Props {
		locations: Location[];
		npcs: { id: string; name: string }[];
		quests: { id: string; title: string }[];
		campaignId: string;
		onUpdate?: () => void;
	}

	let { locations, npcs, quests, campaignId, onUpdate }: Props = $props();

	let search = $state('');
	let typeFilter = $state('all');
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);

	const locationTypes = [
		'city',
		'town',
		'village',
		'dungeon',
		'wilderness',
		'building',
		'region',
		'other'
	] as const;
	const typeIcons: Record<string, string> = {
		city: '🏰',
		town: '🏘️',
		village: '🏡',
		dungeon: '⚔️',
		wilderness: '🌲',
		building: '🏛️',
		region: '🗺️',
		other: '📍'
	};

	let form = $state({
		name: '',
		locationType: 'other' as string,
		description: '',
		parentLocationId: '' as string,
		linkedNpcIds: [] as string[],
		linkedQuestIds: [] as string[],
		tags: '',
		notes: ''
	});

	let filtered = $derived(
		locations.filter((l) => {
			if (typeFilter !== 'all' && l.locationType !== typeFilter) return false;
			if (search) {
				const s = search.toLowerCase();
				return l.name.toLowerCase().includes(s) || l.description.toLowerCase().includes(s);
			}
			return true;
		})
	);

	// Build nested tree structure
	let locationTree = $derived.by(() => {
		const roots = filtered.filter((l) => !l.parentLocationId);
		const children = (parentId: string) => filtered.filter((l) => l.parentLocationId === parentId);
		return { roots, children };
	});

	function openCreate() {
		editingId = null;
		form = {
			name: '',
			locationType: 'other',
			description: '',
			parentLocationId: '',
			linkedNpcIds: [],
			linkedQuestIds: [],
			tags: '',
			notes: ''
		};
		showForm = true;
	}

	function openEdit(loc: Location) {
		editingId = loc.id;
		let npcIds: string[] = [];
		let questIds: string[] = [];
		try {
			npcIds = JSON.parse(loc.linkedNpcIds);
		} catch {
			/* */
		}
		try {
			questIds = JSON.parse(loc.linkedQuestIds);
		} catch {
			/* */
		}
		form = {
			name: loc.name,
			locationType: loc.locationType,
			description: loc.description,
			parentLocationId: loc.parentLocationId || '',
			linkedNpcIds: npcIds,
			linkedQuestIds: questIds,
			tags: (() => {
				try {
					return JSON.parse(loc.tags).join(', ');
				} catch {
					return '';
				}
			})(),
			notes: loc.notes || ''
		};
		showForm = true;
	}

	async function handleSave() {
		if (!form.name.trim()) return;
		saving = true;
		try {
			const tagsArr = form.tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const payload = {
				campaignId,
				name: form.name.trim(),
				locationType: form.locationType as (typeof locationTypes)[number],
				description: form.description,
				parentLocationId: form.parentLocationId || undefined,
				linkedNpcIds: JSON.stringify(form.linkedNpcIds),
				linkedQuestIds: JSON.stringify(form.linkedQuestIds),
				tags: JSON.stringify(tagsArr),
				notes: form.notes || undefined
			};

			if (editingId) {
				await updateLocation({ id: editingId, ...payload });
				Pop.success('Location updated');
			} else {
				await createLocation(payload);
				Pop.success('Location created');
			}
			showForm = false;
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to save location');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(id: string) {
		const confirmed = await Pop.confirm('Delete this location?');
		if (!confirmed) return;
		try {
			await deleteLocation({ id, campaignId });
			Pop.success('Location deleted');
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to delete');
		}
	}

	function getNpcName(id: string) {
		return npcs.find((n) => n.id === id)?.name || id;
	}

	function getQuestTitle(id: string) {
		return quests.find((q) => q.id === id)?.title || id;
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-sm font-semibold">📍 Locations ({locations.length})</h2>
		<div class="flex items-center gap-2">
			<input
				type="text"
				class="input-bordered input input-xs w-40"
				placeholder="Search..."
				bind:value={search}
			/>
			<select class="select-bordered select select-xs" bind:value={typeFilter}>
				<option value="all">All Types</option>
				{#each locationTypes as t (t)}
					<option value={t}>{typeIcons[t]} {t}</option>
				{/each}
			</select>
			<button class="btn btn-xs btn-primary" onclick={openCreate}>+ Add</button>
		</div>
	</div>

	{#if showForm}
		<div class="rounded-box border border-primary/30 bg-base-200 p-4">
			<h3 class="mb-3 text-sm font-semibold">{editingId ? 'Edit' : 'New'} Location</h3>
			<form
				class="grid grid-cols-1 gap-3 md:grid-cols-2"
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
			>
				<div>
					<label class="label-text label text-xs">Name *</label>
					<input
						type="text"
						class="input-bordered input input-sm w-full"
						bind:value={form.name}
						required
					/>
				</div>
				<div>
					<label class="label-text label text-xs">Type</label>
					<select class="select-bordered select w-full select-sm" bind:value={form.locationType}>
						{#each locationTypes as t (t)}
							<option value={t}>{typeIcons[t]} {t}</option>
						{/each}
					</select>
				</div>
				<div class="md:col-span-2">
					<label class="label-text label text-xs">Description</label>
					<textarea
						class="textarea-bordered textarea w-full text-sm"
						rows="2"
						bind:value={form.description}
					></textarea>
				</div>
				<div>
					<label class="label-text label text-xs">Parent Location</label>
					<select
						class="select-bordered select w-full select-sm"
						bind:value={form.parentLocationId}
					>
						<option value="">None (top-level)</option>
						{#each locations.filter((l) => l.id !== editingId) as loc (loc.id)}
							<option value={loc.id}>{typeIcons[loc.locationType] || '📍'} {loc.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="label-text label text-xs">Tags (comma-separated)</label>
					<input
						type="text"
						class="input-bordered input input-sm w-full"
						placeholder="safe, visited, dangerous"
						bind:value={form.tags}
					/>
				</div>
				<div>
					<label class="label-text label text-xs">Linked NPCs</label>
					<select
						class="select-bordered select w-full select-sm"
						multiple
						bind:value={form.linkedNpcIds}
					>
						{#each npcs as npc (npc.id)}
							<option value={npc.id}>{npc.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="label-text label text-xs">Linked Quests</label>
					<select
						class="select-bordered select w-full select-sm"
						multiple
						bind:value={form.linkedQuestIds}
					>
						{#each quests as quest (quest.id)}
							<option value={quest.id}>{quest.title}</option>
						{/each}
					</select>
				</div>
				<div class="md:col-span-2">
					<label class="label-text label text-xs">Notes</label>
					<textarea
						class="textarea-bordered textarea w-full text-sm"
						rows="2"
						bind:value={form.notes}
					></textarea>
				</div>
				<div class="flex gap-2 md:col-span-2">
					<button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
						{#if saving}<span class="loading loading-xs loading-spinner"></span>{:else}{editingId
								? 'Update'
								: 'Create'}{/if}
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (showForm = false)}
						>Cancel</button
					>
				</div>
			</form>
		</div>
	{/if}

	{#if filtered.length === 0}
		<p class="py-8 text-center text-sm opacity-50">
			{locations.length === 0
				? 'No locations yet. Add your first!'
				: 'No locations match the filter.'}
		</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each locationTree.roots as loc (loc.id)}
				{@render locationCard(loc, 0)}
				{#each locationTree.children(loc.id) as child (child.id)}
					{@render locationCard(child, 1)}
					{#each locationTree.children(child.id) as grandchild (grandchild.id)}
						{@render locationCard(grandchild, 2)}
					{/each}
				{/each}
			{/each}
		</div>
	{/if}
</div>

{#snippet locationCard(loc: Location, depth: number)}
	<div
		class="rounded-box border border-base-300 bg-base-100 p-3 transition hover:border-primary/30"
		style="margin-left: {depth * 24}px"
	>
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="text-base">{typeIcons[loc.locationType] || '📍'}</span>
					<span class="font-medium">{loc.name}</span>
					<span class="badge badge-ghost badge-xs">{loc.locationType}</span>
					{#each (() => {
						try {
							return JSON.parse(loc.tags) as string[];
						} catch {
							return [];
						}
					})() as tag (tag)}
						<span class="badge badge-outline badge-xs">{tag}</span>
					{/each}
				</div>
				{#if loc.description}
					<p class="mt-1 text-xs opacity-60">{loc.description}</p>
				{/if}
				<div class="mt-1 flex flex-wrap gap-2">
					{#each (() => {
						try {
							return JSON.parse(loc.linkedNpcIds) as string[];
						} catch {
							return [];
						}
					})() as npcId (npcId)}
						<span class="badge badge-xs badge-info">👤 {getNpcName(npcId)}</span>
					{/each}
					{#each (() => {
						try {
							return JSON.parse(loc.linkedQuestIds) as string[];
						} catch {
							return [];
						}
					})() as questId (questId)}
						<span class="badge badge-xs badge-warning">📜 {getQuestTitle(questId)}</span>
					{/each}
				</div>
				{#if loc.notes}
					<p class="mt-1 text-xs italic opacity-50">{loc.notes}</p>
				{/if}
			</div>
			<div class="flex gap-1">
				<button class="btn btn-ghost btn-xs" onclick={() => openEdit(loc)}>✏️</button>
				<button class="btn text-error btn-ghost btn-xs" onclick={() => handleDelete(loc.id)}
					>🗑️</button
				>
			</div>
		</div>
	</div>
{/snippet}
