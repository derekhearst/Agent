<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pop } from '$lib/dm/pop';
	import NavMenu from '$lib/components/NavMenu.svelte';
	import SourceBookManager from '$lib/dm/SourceBookManager.svelte';
	import FactionTracker from '$lib/dm/FactionTracker.svelte';
	import ConsequenceLog from '$lib/dm/ConsequenceLog.svelte';
	import QuestDashboard from '$lib/dm/QuestDashboard.svelte';
	import NpcGrid from '$lib/dm/NpcGrid.svelte';
	import ItemGrid from '$lib/dm/ItemGrid.svelte';
	import PartyGrid from '$lib/dm/PartyGrid.svelte';
	import DmChatBox from '$lib/dm/DmChatBox.svelte';
	import SessionRecapView from '$lib/dm/SessionRecapView.svelte';
	import DmEditModal from '$lib/dm/DmEditModal.svelte';
	import DiceRoller from '$lib/dm/DiceRoller.svelte';
	import SessionTimeline from '$lib/dm/SessionTimeline.svelte';
	import SessionScratchpad from '$lib/dm/SessionScratchpad.svelte';
	import RuleQuickLookup from '$lib/dm/RuleQuickLookup.svelte';
	import LocationTracker from '$lib/dm/LocationTracker.svelte';
	import InGameCalendar from '$lib/dm/InGameCalendar.svelte';
	import CampaignExportImport from '$lib/dm/CampaignExportImport.svelte';
	import RandomGenerators from '$lib/dm/RandomGenerators.svelte';
	import RelationshipWeb from '$lib/dm/RelationshipWeb.svelte';
	import {
		getCampaignById,
		updateCampaign,
		createSession,
		startSession,
		endSession,
		addSource,
		deleteSource,
		createFaction,
		updateFaction,
		deleteFaction,
		adjustReputation,
		updateConsequence,
		deleteConsequence,
		createQuest,
		updateQuest,
		deleteQuest,
		createItem,
		updateItem,
		deleteItem,
		createNpc,
		updateNpc,
		deleteNpc,
		createPartyMember,
		updatePartyMember,
		deletePartyMember
	} from '$lib/dm/dm.remote';

	const campaignId = page.params.id!;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let campaign = $state<any>(null);
	let isLoading = $state(true);
	type TabKey =
		| 'overview'
		| 'sessions'
		| 'sources'
		| 'world'
		| 'npcs'
		| 'items'
		| 'party'
		| 'locations'
		| 'calendar';
	let activeTab = $state<TabKey>('overview');

	// Modal state
	let modalOpen = $state(false);
	let modalType = $state<'npc' | 'quest' | 'item' | 'party' | 'faction'>('npc');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let modalEntity = $state<Record<string, any> | null>(null);

	function openModal(
		type: typeof modalType,
		entity: Record<string, unknown> | unknown | null = null
	) {
		modalType = type;
		modalEntity = entity as Record<string, unknown> | null;
		modalOpen = true;
	}

	// Campaign inline editing
	let editingCampaign = $state(false);
	let editName = $state('');
	let editDesc = $state('');
	let savingCampaign = $state(false);

	// Loading states for async actions
	let creatingSession = $state(false);
	let startingSession = $state<string | null>(null);
	let endingSession = $state<string | null>(null);

	function startEditCampaign() {
		editName = campaign.name;
		editDesc = campaign.description || '';
		editingCampaign = true;
	}

	async function saveCampaign() {
		savingCampaign = true;
		try {
			await updateCampaign({ id: campaignId, name: editName.trim(), description: editDesc.trim() });
			Pop.success('Campaign updated');
			editingCampaign = false;
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to update campaign');
			console.error(err);
		} finally {
			savingCampaign = false;
		}
	}

	$effect(() => {
		loadCampaign();
	});

	async function loadCampaign() {
		try {
			campaign = await getCampaignById(campaignId);
		} catch (err) {
			console.error('Failed to load campaign:', err);
			Pop.error('Campaign not found');
			await goto('/dm');
		} finally {
			isLoading = false;
		}
	}

	// =================== SESSIONS ===================
	async function handleNewSession() {
		creatingSession = true;
		try {
			await createSession({
				campaignId,
				title: `Session ${(campaign.sessions?.length || 0) + 1}`
			});
			Pop.success('Session created! Prep is generating...');
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to create session');
			console.error(err);
		} finally {
			creatingSession = false;
		}
	}

	async function handleStartSession(sessionId: string) {
		startingSession = sessionId;
		try {
			await startSession(sessionId);
			Pop.success('Session started!');
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to start session');
			console.error(err);
		} finally {
			startingSession = null;
		}
	}

	async function handleEndSession(sessionId: string) {
		const confirmed = await Pop.confirm('End this session? Recaps and hooks will be generated.');
		if (!confirmed) return;
		endingSession = sessionId;
		try {
			await endSession(sessionId);
			Pop.success('Session ended. Generating recaps...');
			setTimeout(loadCampaign, 5000);
			setTimeout(loadCampaign, 15000);
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to end session');
			console.error(err);
		} finally {
			endingSession = null;
		}
	}

	// =================== SOURCES ===================
	async function handleAddSource(data: {
		campaignId: string;
		title: string;
		type: string;
		content: string;
	}) {
		await addSource({ ...data, type: data.type as 'paste' | 'file' });
		await loadCampaign();
	}

	async function handleDeleteSource(id: string) {
		await deleteSource({ id, campaignId });
		await loadCampaign();
	}

	// =================== FACTIONS ===================
	function handleAddFaction() {
		openModal('faction');
	}

	async function handleAdjustReputation(factionId: string, delta: number, reason: string) {
		try {
			await adjustReputation({ factionId, campaignId, delta, reason });
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to adjust reputation');
			console.error(err);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function handleEditFaction(faction: any) {
		openModal('faction', faction);
	}

	// =================== CONSEQUENCES ===================
	async function handleResolveConsequence(id: string, resultIndex: number) {
		const consequence = campaign.consequences.find((c: { id: string }) => c.id === id);
		if (!consequence) return;
		try {
			const results = JSON.parse(consequence.results);
			results[resultIndex].resolved = true;
			await updateConsequence({ id, campaignId, results: JSON.stringify(results) });
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to resolve consequence');
			console.error(err);
		}
	}

	async function handleDeleteConsequence(id: string) {
		await deleteConsequence({ id, campaignId });
		await loadCampaign();
	}

	// =================== QUESTS ===================
	function handleAddQuest() {
		openModal('quest');
	}

	// =================== NPCS ===================
	function handleAddNpc() {
		openModal('npc');
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function handleToggleAlive(npc: any) {
		try {
			await updateNpc({ id: npc.id, campaignId, alive: !npc.alive });
			await loadCampaign();
		} catch (err) {
			Pop.error('Failed to update NPC');
			console.error(err);
		}
	}

	// =================== ITEMS ===================
	function handleAddItem() {
		openModal('item');
	}

	// =================== PARTY ===================
	function handleAddPartyMember() {
		openModal('party');
	}

	// =================== UNIFIED SAVE ===================
	async function handleModalSave(data: Record<string, unknown>) {
		switch (modalType) {
			case 'npc':
				if (data.id) await updateNpc(data as Parameters<typeof updateNpc>[0]);
				else await createNpc(data as Parameters<typeof createNpc>[0]);
				break;
			case 'quest':
				if (data.id) await updateQuest(data as Parameters<typeof updateQuest>[0]);
				else await createQuest(data as Parameters<typeof createQuest>[0]);
				break;
			case 'item':
				if (data.id) await updateItem(data as Parameters<typeof updateItem>[0]);
				else await createItem(data as Parameters<typeof createItem>[0]);
				break;
			case 'party':
				if (data.id) await updatePartyMember(data as Parameters<typeof updatePartyMember>[0]);
				else await createPartyMember(data as Parameters<typeof createPartyMember>[0]);
				break;
			case 'faction':
				if (data.id) await updateFaction(data as Parameters<typeof updateFaction>[0]);
				else await createFaction(data as Parameters<typeof createFaction>[0]);
				break;
		}
		await loadCampaign();
	}

	async function handleModalDelete(id: string) {
		switch (modalType) {
			case 'npc':
				await deleteNpc({ id, campaignId });
				break;
			case 'quest':
				await deleteQuest({ id, campaignId });
				break;
			case 'item':
				await deleteItem({ id, campaignId });
				break;
			case 'party':
				await deletePartyMember({ id, campaignId });
				break;
			case 'faction':
				await deleteFaction({ id, campaignId });
				break;
		}
		await loadCampaign();
	}

	// Derive active session
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let activeSession = $derived(campaign?.sessions?.find((s: any) => s.status === 'active') || null);

	function sessionStatusClass(status: string): string {
		switch (status) {
			case 'active':
				return 'badge-warning';
			case 'completed':
				return 'badge-success';
			default:
				return 'badge-info';
		}
	}
	// Mobile sidebar
	let sidebarOpen = $state(false);
</script>

<div class="flex h-screen">
	<!-- Mobile sidebar toggle -->
	<button
		class="btn fixed top-2 left-2 z-50 btn-ghost btn-sm lg:hidden"
		onclick={() => (sidebarOpen = !sidebarOpen)}
	>
		{sidebarOpen ? '✕' : '☰'}
	</button>

	<!-- Sidebar -->
	<div
		class="fixed inset-y-0 left-0 z-40 w-56 shrink-0 transform bg-base-100 transition-transform duration-200 lg:static lg:translate-x-0"
		class:translate-x-0={sidebarOpen}
		class:-translate-x-full={!sidebarOpen}
	>
		<NavMenu currentRoute="/dm" />
	</div>

	<!-- Backdrop for mobile -->
	{#if sidebarOpen}
		<button
			class="fixed inset-0 z-30 bg-black/30 lg:hidden"
			onclick={() => (sidebarOpen = false)}
			aria-label="Close sidebar"
		></button>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		{#if isLoading}
			<div class="flex flex-1 items-center justify-center">
				<span class="loading loading-lg loading-spinner"></span>
			</div>
		{:else if campaign}
			<!-- Campaign Header -->
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<div class="flex items-center gap-3">
					<a href="/dm" class="btn btn-ghost btn-sm">← Back</a>
					{#if editingCampaign}
						<div class="flex items-center gap-2">
							<input type="text" class="input-bordered input input-sm w-60" bind:value={editName} />
							<input
								type="text"
								class="input-bordered input input-sm w-60"
								bind:value={editDesc}
								placeholder="Description"
							/>
							<button
								class="btn btn-sm btn-primary"
								onclick={saveCampaign}
								disabled={savingCampaign}
							>
								{#if savingCampaign}<span class="loading loading-xs loading-spinner"
									></span>{:else}Save{/if}
							</button>
							<button class="btn btn-ghost btn-sm" onclick={() => (editingCampaign = false)}
								>Cancel</button
							>
						</div>
					{:else}
						<div>
							<h1 class="text-lg font-semibold">
								{campaign.name}
								<button
									class="btn opacity-40 btn-ghost btn-xs hover:opacity-100"
									onclick={startEditCampaign}>✏️</button
								>
							</h1>
							<p class="text-sm opacity-50">{campaign.description || 'No description'}</p>
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					<CampaignExportImport {campaignId} campaignName={campaign.name} />
					{#if activeSession}
						<span class="badge badge-warning">Session {activeSession.sessionNumber} Active</span>
						<button
							class="btn btn-sm btn-error"
							onclick={() => handleEndSession(activeSession.id)}
							disabled={endingSession === activeSession.id}
						>
							{#if endingSession === activeSession.id}<span
									class="loading loading-xs loading-spinner"
								></span> Ending...{:else}End Session{/if}
						</button>
					{:else}
						<button
							class="btn btn-sm btn-accent"
							onclick={handleNewSession}
							disabled={creatingSession}
						>
							{#if creatingSession}<span class="loading loading-xs loading-spinner"></span> Creating...{:else}+
								New Session{/if}
						</button>
					{/if}
				</div>
			</div>

			<!-- Tabs -->
			<div class="border-b border-base-300 px-4">
				<div role="tablist" class="tabs-bordered tabs">
					{#each [{ key: 'overview', label: '📊 Overview' }, { key: 'sessions', label: '📋 Sessions' }, { key: 'sources', label: '📚 Sources' }, { key: 'world', label: '🌍 World State' }, { key: 'npcs', label: '👤 NPCs' }, { key: 'items', label: '⚔️ Items' }, { key: 'party', label: '🛡️ Party' }, { key: 'locations', label: '📍 Locations' }, { key: 'calendar', label: '📅 Calendar' }] as tab (tab.key)}
						<button
							role="tab"
							class="tab"
							class:tab-active={activeTab === tab.key}
							onclick={() => (activeTab = tab.key as TabKey)}>{tab.label}</button
						>
					{/each}
				</div>
			</div>

			<!-- Tab Content -->
			<div class="flex flex-1 overflow-hidden">
				<div class="flex-1 overflow-y-auto p-4">
					{#if activeTab === 'overview'}
						<!-- Overview: Quick stats + Chat -->
						<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
							<div class="lg:col-span-2">
								<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
									<div class="stat rounded-box border border-base-300 bg-base-200 p-3">
										<div class="stat-title text-xs">Sessions</div>
										<div class="stat-value text-lg">{campaign.sessions?.length || 0}</div>
									</div>
									<div class="stat rounded-box border border-base-300 bg-base-200 p-3">
										<div class="stat-title text-xs">NPCs</div>
										<div class="stat-value text-lg">{campaign.npcs?.length || 0}</div>
									</div>
									<div class="stat rounded-box border border-base-300 bg-base-200 p-3">
										<div class="stat-title text-xs">Active Quests</div>
										<div class="stat-value text-lg">
											{campaign.quests?.filter((q: { status: string }) => q.status === 'active')
												.length || 0}
										</div>
									</div>
									<div class="stat rounded-box border border-base-300 bg-base-200 p-3">
										<div class="stat-title text-xs">Factions</div>
										<div class="stat-value text-lg">{campaign.factions?.length || 0}</div>
									</div>
								</div>

								<!-- Recent activity / latest session -->
								{#if campaign.sessions?.length > 0}
									{@const latest = campaign.sessions[0]}
									<div class="mt-4 rounded-box border border-base-300 bg-base-200 p-4">
										<h3 class="mb-2 text-sm font-semibold">Latest Session</h3>
										<div class="flex items-center gap-2">
											<span class="text-sm font-medium"
												>Session {latest.sessionNumber}: {latest.title}</span
											>
											<span class="badge badge-sm {sessionStatusClass(latest.status)}"
												>{latest.status}</span
											>
										</div>
										{#if latest.status === 'prep'}
											<button
												class="btn mt-2 btn-sm btn-warning"
												onclick={() => handleStartSession(latest.id)}
												disabled={startingSession === latest.id}
											>
												{#if startingSession === latest.id}<span
														class="loading loading-xs loading-spinner"
													></span> Starting...{:else}Start Session{/if}
											</button>
										{/if}
										{#if latest.prepContent || latest.dmRecap}
											<div class="mt-3">
												<SessionRecapView
													dmRecap={latest.dmRecap}
													playerRecap={latest.playerRecap}
													nextSessionHooks={latest.nextSessionHooks || '[]'}
													prepContent={latest.prepContent}
												/>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Side: Quick Faction view + Unresolved consequences -->
							<div class="flex flex-col gap-4">
								{#if campaign.factions?.length > 0}
									<FactionTracker
										factions={campaign.factions}
										onAdjust={handleAdjustReputation}
										onAdd={handleAddFaction}
										onEdit={() => (activeTab = 'world')}
									/>
								{/if}
								{#if campaign.consequences?.length > 0}
									<ConsequenceLog
										consequences={campaign.consequences.slice(0, 5)}
										onResolve={handleResolveConsequence}
										onDelete={handleDeleteConsequence}
									/>
								{/if}
								<DiceRoller />
								<RandomGenerators />
								<RuleQuickLookup {campaignId} />
								{#if campaign.sessions?.length > 0}
									<SessionTimeline
										sessions={campaign.sessions}
										onSelect={() => (activeTab = 'sessions')}
									/>
								{/if}
							</div>
						</div>

						<!-- Campaign Chat (always visible at bottom of overview) -->
						{#if campaign.chatSessionId}
							<div
								class="mt-4 rounded-box border border-base-300 bg-base-200"
								style="height: clamp(300px, 40vh, 600px);"
							>
								<DmChatBox {campaignId} sessionId={campaign.chatSessionId} />
							</div>
						{/if}

						<!-- Relationship Web -->
						{#if campaign.npcs?.length > 0 || campaign.factions?.length > 0}
							<div class="mt-4">
								<RelationshipWeb npcs={campaign.npcs || []} factions={campaign.factions || []} />
							</div>
						{/if}

						<!-- Session Scratchpad for active session -->
						{#if activeSession}
							<div class="mt-4">
								<SessionScratchpad session={activeSession} {campaignId} onUpdate={loadCampaign} />
							</div>
						{/if}
					{:else if activeTab === 'sessions'}
						<div class="flex flex-col gap-4">
							<div class="flex items-center justify-between">
								<h2 class="text-sm font-semibold">Sessions ({campaign.sessions?.length || 0})</h2>
								<button
									class="btn btn-xs btn-primary"
									onclick={handleNewSession}
									disabled={creatingSession}
								>
									{#if creatingSession}<span class="loading loading-xs loading-spinner"
										></span>{:else}+ New Session{/if}
								</button>
							</div>

							{#if campaign.sessions?.length === 0}
								<p class="py-8 text-center text-sm opacity-50">
									No sessions yet. Create one to get started.
								</p>
							{:else}
								<div class="flex flex-col gap-3">
									{#each campaign.sessions as session (session.id)}
										<div class="rounded-box border border-base-300 bg-base-100 p-4">
											<div class="flex items-center justify-between">
												<div class="flex items-center gap-2">
													<span class="text-lg font-bold opacity-30">#{session.sessionNumber}</span>
													<span class="text-sm font-medium">{session.title}</span>
													<span class="badge badge-sm {sessionStatusClass(session.status)}"
														>{session.status}</span
													>
												</div>
												<div class="flex gap-2">
													{#if session.status === 'prep'}
														<button
															class="btn btn-xs btn-warning"
															onclick={() => handleStartSession(session.id)}
															disabled={startingSession === session.id}
														>
															{#if startingSession === session.id}<span
																	class="loading loading-xs loading-spinner"
																></span>{:else}Start{/if}
														</button>
													{:else if session.status === 'active'}
														<button
															class="btn btn-xs btn-error"
															onclick={() => handleEndSession(session.id)}
															disabled={endingSession === session.id}
														>
															{#if endingSession === session.id}<span
																	class="loading loading-xs loading-spinner"
																></span>{:else}End Session{/if}
														</button>
													{/if}
												</div>
											</div>

											{#if session.prepContent || session.dmRecap}
												<div class="mt-3">
													<SessionRecapView
														dmRecap={session.dmRecap}
														playerRecap={session.playerRecap}
														nextSessionHooks={session.nextSessionHooks || '[]'}
														prepContent={session.prepContent}
													/>
												</div>
											{/if}

											{#if session.status === 'active' && session.chatSessionId}
												<div
													class="mt-3 rounded-box border border-primary/20"
													style="height: clamp(300px, 40vh, 600px);"
												>
													<DmChatBox
														{campaignId}
														sessionId={session.chatSessionId}
														dmSessionId={session.id}
													/>
												</div>
											{/if}

											{#if session.status === 'active'}
												<div class="mt-3">
													<SessionScratchpad {session} {campaignId} onUpdate={loadCampaign} />
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{:else if activeTab === 'sources'}
						<SourceBookManager
							{campaignId}
							sources={campaign.sources || []}
							onAdd={handleAddSource}
							onDelete={handleDeleteSource}
						/>
					{:else if activeTab === 'world'}
						<div class="flex flex-col gap-6">
							<FactionTracker
								factions={campaign.factions || []}
								onAdjust={handleAdjustReputation}
								onAdd={handleAddFaction}
								onEdit={handleEditFaction}
							/>

							<QuestDashboard
								quests={campaign.quests || []}
								onAdd={handleAddQuest}
								onEdit={(q) => openModal('quest', q)}
								onStatusChange={async (id, status) => {
									await updateQuest({
										id,
										campaignId,
										status: status as 'active' | 'completed' | 'failed' | 'hidden'
									});
									await loadCampaign();
								}}
							/>

							<ConsequenceLog
								consequences={campaign.consequences || []}
								onResolve={handleResolveConsequence}
								onDelete={handleDeleteConsequence}
							/>
						</div>
					{:else if activeTab === 'npcs'}
						<NpcGrid
							npcs={campaign.npcs || []}
							factions={campaign.factions || []}
							onAdd={handleAddNpc}
							onEdit={(npc) => openModal('npc', npc)}
							onToggleAlive={handleToggleAlive}
						/>
					{:else if activeTab === 'items'}
						<ItemGrid
							items={campaign.items || []}
							onAdd={handleAddItem}
							onEdit={(item) => openModal('item', item)}
						/>
					{:else if activeTab === 'party'}
						<PartyGrid
							members={campaign.partyMembers || []}
							onAdd={handleAddPartyMember}
							onEdit={(m) => openModal('party', m)}
						/>
					{:else if activeTab === 'locations'}
						<LocationTracker
							locations={campaign.locations || []}
							npcs={campaign.npcs || []}
							quests={campaign.quests || []}
							{campaignId}
							onUpdate={loadCampaign}
						/>
					{:else if activeTab === 'calendar'}
						<InGameCalendar
							events={campaign.calendarEvents || []}
							currentGameDay={campaign.currentGameDay || 1}
							{campaignId}
							onUpdate={loadCampaign}
						/>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<DmEditModal
	open={modalOpen}
	entityType={modalType}
	entity={modalEntity}
	{campaignId}
	factions={campaign?.factions || []}
	onSave={handleModalSave}
	onDelete={handleModalDelete}
	onClose={() => (modalOpen = false)}
/>
