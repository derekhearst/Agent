<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import { updateSessionNotes } from '$lib/dm/dm.remote';

	interface Props {
		session: { id: string; notes?: string | null; sessionNumber: number };
		campaignId: string;
		onUpdate?: () => void;
	}

	let { session, campaignId, onUpdate }: Props = $props();

	let notes = $derived(session.notes || '');
	let editedNotes = $state('');
	let hasEdited = $state(false);
	let saving = $state(false);
	let dirty = $derived(hasEdited && editedNotes !== (session.notes || ''));
	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

	// Sync with incoming prop when not editing
	$effect(() => {
		if (!hasEdited) {
			editedNotes = notes;
		}
	});

	function scheduleAutoSave() {
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			if (dirty) handleSave();
		}, 3000);
	}

	async function handleSave() {
		if (!dirty) return;
		saving = true;
		try {
			await updateSessionNotes({ sessionId: session.id, campaignId, notes: editedNotes });
			hasEdited = false;
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to save notes');
		} finally {
			saving = false;
		}
	}
</script>

<div class="rounded-box border border-base-300 bg-base-200 p-4">
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-sm font-semibold">
			📝 Scratchpad — Session {session.sessionNumber}
		</h3>
		<div class="flex items-center gap-2">
			{#if dirty}
				<span class="badge badge-xs badge-warning">unsaved</span>
			{/if}
			<button class="btn btn-xs btn-primary" onclick={handleSave} disabled={saving || !dirty}>
				{#if saving}<span class="loading loading-xs loading-spinner"></span>{:else}Save{/if}
			</button>
		</div>
	</div>
	<textarea
		class="textarea-bordered textarea w-full font-mono text-sm"
		rows="10"
		placeholder="Quick notes during the session... NPCs introduced, events, player quotes, reminders..."
		bind:value={editedNotes}
		oninput={() => {
			hasEdited = true;
			scheduleAutoSave();
		}}
	></textarea>
	<p class="mt-1 text-xs opacity-40">Auto-saves after 3 seconds of inactivity</p>
</div>
