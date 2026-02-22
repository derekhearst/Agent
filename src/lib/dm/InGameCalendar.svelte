<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import {
		createCalendarEvent,
		updateCalendarEvent,
		deleteCalendarEvent,
		updateCampaign
	} from '$lib/dm/dm.remote';

	interface CalendarEvent {
		id: string;
		title: string;
		description: string;
		gameDay: number;
		category: string;
	}

	interface Props {
		events: CalendarEvent[];
		currentGameDay: number;
		campaignId: string;
		onUpdate?: () => void;
	}

	let { events, currentGameDay, campaignId, onUpdate }: Props = $props();

	const categories = [
		'quest_deadline',
		'festival',
		'political',
		'travel',
		'combat',
		'note'
	] as const;
	const catIcons: Record<string, string> = {
		quest_deadline: '⏰',
		festival: '🎉',
		political: '👑',
		travel: '🗺️',
		combat: '⚔️',
		note: '📝'
	};
	const catColors: Record<string, string> = {
		quest_deadline: 'badge-error',
		festival: 'badge-accent',
		political: 'badge-warning',
		travel: 'badge-info',
		combat: 'badge-secondary',
		note: 'badge-ghost'
	};

	let viewRange = $state(7); // days to show at a time
	let viewStart = $derived(Math.max(1, currentGameDay - 1));
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let advancingDay = $state(false);

	let form = $state({
		title: '',
		description: '',
		gameDay: 1,
		category: 'note' as string
	});

	// Sync form day with currentGameDay prop
	$effect(() => {
		form.gameDay = currentGameDay;
	});

	// Build days with events
	let dayRange = $derived.by(() => {
		const days: { day: number; events: CalendarEvent[] }[] = [];
		for (let d = viewStart; d < viewStart + viewRange; d++) {
			days.push({
				day: d,
				events: events.filter((e) => e.gameDay === d)
			});
		}
		return days;
	});

	// Find nearest upcoming events
	let upcomingEvents = $derived(
		events
			.filter((e) => e.gameDay >= currentGameDay)
			.sort((a, b) => a.gameDay - b.gameDay)
			.slice(0, 5)
	);

	function openCreate(day?: number) {
		editingId = null;
		form = { title: '', description: '', gameDay: day ?? currentGameDay, category: 'note' };
		showForm = true;
	}

	function openEdit(ev: CalendarEvent) {
		editingId = ev.id;
		form = {
			title: ev.title,
			description: ev.description,
			gameDay: ev.gameDay,
			category: ev.category
		};
		showForm = true;
	}

	async function handleSave() {
		if (!form.title.trim()) return;
		saving = true;
		try {
			const payload = {
				campaignId,
				title: form.title.trim(),
				description: form.description,
				gameDay: form.gameDay,
				category: form.category as (typeof categories)[number]
			};
			if (editingId) {
				await updateCalendarEvent({ id: editingId, ...payload });
				Pop.success('Event updated');
			} else {
				await createCalendarEvent(payload);
				Pop.success('Event added');
			}
			showForm = false;
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to save event');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(id: string) {
		const confirmed = await Pop.confirm('Delete this event?');
		if (!confirmed) return;
		try {
			await deleteCalendarEvent({ id, campaignId });
			Pop.success('Event deleted');
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to delete event');
		}
	}

	async function advanceDay(delta: number) {
		const newDay = Math.max(1, currentGameDay + delta);
		advancingDay = true;
		try {
			await updateCampaign({ id: campaignId, currentGameDay: newDay });
			if (onUpdate) onUpdate();
		} catch (err) {
			console.error(err);
			Pop.error('Failed to update day');
		} finally {
			advancingDay = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Day control bar -->
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-3">
			<h2 class="text-sm font-semibold">📅 In-Game Calendar</h2>
			<div class="flex items-center gap-1 rounded-lg bg-base-300 px-2 py-1">
				<button
					class="btn btn-ghost btn-xs"
					onclick={() => advanceDay(-1)}
					disabled={advancingDay || currentGameDay <= 1}>←</button
				>
				<span class="min-w-20 text-center text-sm font-bold">Day {currentGameDay}</span>
				<button class="btn btn-ghost btn-xs" onclick={() => advanceDay(1)} disabled={advancingDay}
					>→</button
				>
			</div>
			{#if advancingDay}
				<span class="loading loading-xs loading-spinner"></span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			<select class="select-bordered select select-xs" bind:value={viewRange}>
				<option value={7}>7 Days</option>
				<option value={14}>14 Days</option>
				<option value={30}>30 Days</option>
			</select>
			<button class="btn btn-xs btn-primary" onclick={() => openCreate()}>+ Event</button>
		</div>
	</div>

	{#if showForm}
		<div class="rounded-box border border-primary/30 bg-base-200 p-4">
			<h3 class="mb-3 text-sm font-semibold">{editingId ? 'Edit' : 'New'} Event</h3>
			<form
				class="grid grid-cols-1 gap-3 md:grid-cols-3"
				onsubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
			>
				<div>
					<label class="label-text label text-xs">Title *</label>
					<input
						type="text"
						class="input-bordered input input-sm w-full"
						bind:value={form.title}
						required
					/>
				</div>
				<div>
					<label class="label-text label text-xs">Day</label>
					<input
						type="number"
						class="input-bordered input input-sm w-full"
						min="1"
						bind:value={form.gameDay}
					/>
				</div>
				<div>
					<label class="label-text label text-xs">Category</label>
					<select class="select-bordered select w-full select-sm" bind:value={form.category}>
						{#each categories as cat (cat)}
							<option value={cat}>{catIcons[cat]} {cat.replace('_', ' ')}</option>
						{/each}
					</select>
				</div>
				<div class="md:col-span-3">
					<label class="label-text label text-xs">Description</label>
					<textarea
						class="textarea-bordered textarea w-full text-sm"
						rows="2"
						bind:value={form.description}
					></textarea>
				</div>
				<div class="flex gap-2 md:col-span-3">
					<button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
						{#if saving}<span class="loading loading-xs loading-spinner"></span>{:else}{editingId
								? 'Update'
								: 'Add'}{/if}
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (showForm = false)}
						>Cancel</button
					>
					{#if editingId}
						<button
							type="button"
							class="btn btn-outline btn-sm btn-error"
							onclick={() => editingId && handleDelete(editingId)}>Delete</button
						>
					{/if}
				</div>
			</form>
		</div>
	{/if}

	<!-- Timeline view -->
	<div class="grid grid-cols-1 gap-1">
		{#each dayRange as { day, events: dayEvents } (day)}
			<div
				class="flex items-start gap-3 rounded-lg border p-2 transition {day === currentGameDay
					? 'border-primary bg-primary/5'
					: 'border-base-300'} {day < currentGameDay ? 'opacity-50' : ''}"
			>
				<div class="flex w-16 shrink-0 flex-col items-center">
					<span class="text-xs opacity-40">Day</span>
					<span class="text-lg font-bold" class:text-primary={day === currentGameDay}>{day}</span>
					{#if day === currentGameDay}
						<span class="badge badge-xs badge-primary">Today</span>
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					{#if dayEvents.length === 0}
						<button class="text-xs opacity-30 hover:opacity-60" onclick={() => openCreate(day)}
							>+ add event</button
						>
					{:else}
						<div class="flex flex-col gap-1">
							{#each dayEvents as ev (ev.id)}
								<div class="flex items-center justify-between gap-2">
									<div class="flex items-center gap-1">
										<span>{catIcons[ev.category] || '📝'}</span>
										<span class="text-sm font-medium">{ev.title}</span>
										<span class="badge badge-xs {catColors[ev.category] || 'badge-ghost'}"
											>{ev.category.replace('_', ' ')}</span
										>
									</div>
									<div class="flex gap-1">
										<button class="btn btn-ghost btn-xs" onclick={() => openEdit(ev)}>✏️</button>
										<button
											class="btn text-error btn-ghost btn-xs"
											onclick={() => handleDelete(ev.id)}>🗑️</button
										>
									</div>
								</div>
								{#if ev.description}
									<p class="ml-6 text-xs opacity-50">{ev.description}</p>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Upcoming events sidebar -->
	{#if upcomingEvents.length > 0}
		<div class="rounded-box border border-base-300 bg-base-200 p-3">
			<h3 class="mb-1 text-xs font-semibold opacity-60">Upcoming</h3>
			{#each upcomingEvents as ev (ev.id)}
				<div class="flex items-center gap-2 py-0.5">
					<span class="font-mono text-xs opacity-40">D{ev.gameDay}</span>
					<span>{catIcons[ev.category] || '📝'}</span>
					<span class="text-xs">{ev.title}</span>
					{#if ev.gameDay - currentGameDay > 0}
						<span class="text-xs opacity-40">(in {ev.gameDay - currentGameDay}d)</span>
					{:else}
						<span class="badge badge-xs badge-primary">today</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
