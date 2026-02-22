<script lang="ts">
	import NavMenu from '$lib/components/NavMenu.svelte';
	import GeometricPattern from '$lib/components/GeometricPattern.svelte';
	import CampaignCard from '$lib/dm/CampaignCard.svelte';
	import { Pop } from '$lib/dm/pop';
	import { goto } from '$app/navigation';
	import {
		getCampaigns,
		createCampaign,
		deleteCampaign as deleteCampaignRemote
	} from '$lib/dm/dm.remote';

	let campaigns = $state<
		Array<{
			id: string;
			name: string;
			description: string;
			sessionCount: number;
			hasSourceBooks: boolean;
			lastSession: { title: string; status: string; sessionNumber: number } | null;
			createdAt: Date;
			updatedAt: Date;
		}>
	>([]);
	let isLoading = $state(true);
	let showCreate = $state(false);
	let newName = $state('');
	let newDesc = $state('');
	let isCreating = $state(false);

	$effect(() => {
		loadCampaigns();
	});

	async function loadCampaigns() {
		try {
			campaigns = await getCampaigns();
		} catch (err) {
			console.error('Failed to load campaigns:', err);
		} finally {
			isLoading = false;
		}
	}

	async function handleCreate() {
		if (!newName.trim()) return;
		isCreating = true;
		try {
			const campaign = await createCampaign({ name: newName.trim(), description: newDesc.trim() });
			Pop.success('Campaign created!');
			showCreate = false;
			newName = '';
			newDesc = '';
			await goto(`/dm/${campaign.id}`);
		} catch (err) {
			Pop.error('Failed to create campaign');
			console.error(err);
		} finally {
			isCreating = false;
		}
	}

	async function handleDelete(id: string) {
		const confirmed = await Pop.confirm('Delete this campaign? All data will be permanently lost.');
		if (!confirmed) return;
		try {
			await deleteCampaignRemote(id);
			Pop.success('Campaign deleted');
			await loadCampaigns();
		} catch (err) {
			Pop.error('Delete failed');
			console.error(err);
		}
	}
	let sidebarOpen = $state(false);
</script>

<div class="flex h-screen">
	<button
		class="btn fixed top-2 left-2 z-50 btn-ghost btn-sm lg:hidden"
		onclick={() => (sidebarOpen = !sidebarOpen)}
	>
		{sidebarOpen ? '✕' : '☰'}
	</button>

	<div
		class="fixed inset-y-0 left-0 z-40 w-56 shrink-0 transform bg-base-100 transition-transform duration-200 lg:static lg:translate-x-0"
		class:translate-x-0={sidebarOpen}
		class:-translate-x-full={!sidebarOpen}
	>
		<NavMenu currentRoute="/dm" />
	</div>

	{#if sidebarOpen}
		<button
			class="fixed inset-0 z-30 bg-black/30 lg:hidden"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close sidebar"
		></button>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
			<div>
				<h1 class="text-lg font-semibold">🎲 DM Assistant</h1>
				<p class="text-sm opacity-50">
					{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
				</p>
			</div>
			<button class="btn btn-sm btn-primary" onclick={() => (showCreate = true)}>
				+ New Campaign
			</button>
		</div>

		<!-- Create form -->
		{#if showCreate}
			<div class="border-b border-base-300 bg-base-200 p-4">
				<div class="flex flex-col gap-3">
					<input
						type="text"
						class="input-bordered input input-sm"
						placeholder="Campaign name (e.g. Curse of Strahd)"
						bind:value={newName}
					/>
					<textarea
						class="textarea-bordered textarea textarea-sm"
						placeholder="Brief description (optional)"
						bind:value={newDesc}
					></textarea>
					<div class="flex justify-end gap-2">
						<button class="btn btn-ghost btn-sm" onclick={() => (showCreate = false)}>Cancel</button
						>
						<button
							class="btn btn-sm btn-primary"
							disabled={!newName.trim() || isCreating}
							onclick={handleCreate}
						>
							{isCreating ? 'Creating...' : 'Create Campaign'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Campaign grid -->
		<div class="relative flex-1 overflow-y-auto p-4">
			{#if isLoading}
				<div class="flex items-center justify-center py-20">
					<span class="loading loading-lg loading-spinner"></span>
				</div>
			{:else if campaigns.length === 0}
				<GeometricPattern variant="grid" opacity={0.05} />
				<div class="relative z-10 flex flex-col items-center justify-center py-20 text-center">
					<div class="mb-4 text-5xl">🎲</div>
					<h3
						class="mb-2 bg-linear-to-r from-primary to-secondary bg-clip-text text-lg font-bold text-transparent"
					>
						No campaigns yet
					</h3>
					<p class="mb-6 text-sm opacity-50">Create your first D&D 5e campaign to get started.</p>
					<button class="btn btn-primary" onclick={() => (showCreate = true)}>
						+ Create Campaign
					</button>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each campaigns as campaign (campaign.id)}
						<CampaignCard {campaign} onSelect={(id) => goto(`/dm/${id}`)} onDelete={handleDelete} />
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
