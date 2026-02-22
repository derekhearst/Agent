<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import { importCharacterSheet } from '$lib/dm/dm.remote';

	interface PartyMember {
		id: string;
		campaignId: string;
		playerName: string;
		characterName: string;
		race: string | null;
		class: string | null;
		level: number;
		backstoryHooks: string;
		notableItems: string;
		relationships: string;
		notes: string | null;
	}

	interface Props {
		members: PartyMember[];
		campaignId: string;
		onAdd: () => void;
		onEdit: (member: PartyMember) => void;
		onUpdate?: () => void;
	}

	let { members, campaignId, onAdd, onEdit, onUpdate }: Props = $props();

	let search = $state('');
	let isUploading = $state(false);
	let uploadProgress = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	let filtered = $derived.by(() => {
		if (!search.trim()) return members;
		const q = search.toLowerCase();
		return members.filter(
			(m) =>
				m.characterName.toLowerCase().includes(q) ||
				m.playerName.toLowerCase().includes(q) ||
				(m.race?.toLowerCase().includes(q) ?? false) ||
				(m.class?.toLowerCase().includes(q) ?? false)
		);
	});

	function parseItems(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	function parseAbilityScores(
		notes: string
	): { str: string; dex: string; con: string; int: string; wis: string; cha: string } | null {
		if (!notes) return null;
		const patterns = [
			// "STR 8 (-1), DEX 17 (+3)" or "STR: 8, DEX: 17"
			/STR[:\s]*(\d+)/i,
			/DEX[:\s]*(\d+)/i,
			/CON[:\s]*(\d+)/i,
			/INT[:\s]*(\d+)/i,
			/WIS[:\s]*(\d+)/i,
			/CHA[:\s]*(\d+)/i
		];
		const [strM, dexM, conM, intM, wisM, chaM] = patterns.map((p) => notes.match(p));
		if (!strM && !dexM && !conM) return null;
		return {
			str: strM?.[1] || '—',
			dex: dexM?.[1] || '—',
			con: conM?.[1] || '—',
			int: intM?.[1] || '—',
			wis: wisM?.[1] || '—',
			cha: chaM?.[1] || '—'
		};
	}

	function extractStat(notes: string, stat: string): string | null {
		if (!notes) return null;
		// Match patterns like "HP: 24", "HP 24", "HP: 24 Max", "24 HP", "24 Max HP"
		const patterns = [
			new RegExp(`${stat}[:\\s]+([\\d]+)`, 'i'),
			new RegExp(`([\\d]+)\\s*(?:Max\\s+)?${stat}`, 'i')
		];
		for (const p of patterns) {
			const m = notes.match(p);
			if (m) return m[1];
		}
		return null;
	}

	async function handlePdfUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (!files || files.length === 0) return;

		isUploading = true;
		let totalCreated = 0;

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (file.type !== 'application/pdf') {
					Pop.error(`${file.name} is not a PDF — skipped`);
					continue;
				}

				uploadProgress = `Extracting text from ${file.name}... (${i + 1}/${files.length})`;

				// Step 1: Extract text via API
				const formData = new FormData();
				formData.append('file', file);
				const parseRes = await fetch('/api/dm/parse-pdf', { method: 'POST', body: formData });
				if (!parseRes.ok) {
					const err = await parseRes.json();
					Pop.error(`Failed to parse ${file.name}: ${err.error}`);
					continue;
				}
				const { text, filename } = await parseRes.json();

				if (!text || text.trim().length < 50) {
					Pop.error(`${file.name} doesn't contain enough text — is it a scanned image?`);
					continue;
				}

				uploadProgress = `AI is parsing ${file.name}...`;

				// Step 2: AI parses + creates party members
				const result = await importCharacterSheet({
					campaignId,
					pdfText: text,
					filename
				});
				totalCreated += result.count;
			}

			if (totalCreated > 0) {
				Pop.success(`Imported ${totalCreated} character${totalCreated > 1 ? 's' : ''} from PDF!`);
				if (onUpdate) onUpdate();
			} else {
				Pop.info('No characters were extracted. Try a different PDF or add manually.');
			}
		} catch (err) {
			console.error('PDF import error:', err);
			Pop.error(err instanceof Error ? err.message : 'Failed to import character sheet');
		} finally {
			isUploading = false;
			uploadProgress = '';
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">Party ({filtered.length})</h3>
		<div class="flex items-center gap-2">
			<input
				type="text"
				class="input-bordered input input-xs w-36"
				placeholder="Search party..."
				bind:value={search}
			/>
			<input
				type="file"
				accept=".pdf"
				multiple
				class="hidden"
				bind:this={fileInput}
				onchange={handlePdfUpload}
			/>
			<button
				class="btn btn-outline btn-xs"
				onclick={() => fileInput?.click()}
				disabled={isUploading}
			>
				{#if isUploading}
					<span class="loading loading-xs loading-spinner"></span>
				{:else}
					📄
				{/if}
				Upload PDF
			</button>
			<button class="btn btn-xs btn-primary" onclick={onAdd}>+ Member</button>
		</div>
	</div>

	{#if isUploading && uploadProgress}
		<div class="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2">
			<span class="loading loading-xs loading-spinner text-info"></span>
			<span class="text-xs">{uploadProgress}</span>
		</div>
	{/if}

	{#if members.length === 0}
		<p class="py-4 text-center text-sm opacity-50">No party members added yet.</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each filtered as m (m.id)}
				{@const items = parseItems(m.notableItems)}
				{@const stats = parseAbilityScores(m.notes || '')}
				{@const hp = extractStat(m.notes || '', 'HP')}
				{@const ac = extractStat(m.notes || '', 'AC')}
				<button
					class="group rounded-box border border-base-300 bg-base-100 p-0 text-left transition-all hover:border-primary/30 hover:shadow-lg"
					onclick={() => onEdit(m)}
				>
					<!-- Header -->
					<div class="flex items-start justify-between rounded-t-box bg-base-200/60 px-4 py-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="text-base font-bold">{m.characterName}</span>
								<span class="badge badge-primary badge-sm">Lv {m.level}</span>
							</div>
							<div class="mt-0.5 text-xs opacity-60">
								{#if m.race || m.class}
									<span>{[m.race, m.class].filter(Boolean).join(' · ')}</span>
								{/if}
							</div>
						</div>
						<div class="text-right">
							<div class="text-[10px] uppercase tracking-wider opacity-40">Player</div>
							<div class="text-xs font-medium">{m.playerName}</div>
						</div>
					</div>

					<!-- Ability Scores Bar (if found in notes) -->
					{#if stats}
						<div class="grid grid-cols-6 border-b border-base-300 text-center">
							{#each [['STR', stats.str], ['DEX', stats.dex], ['CON', stats.con], ['INT', stats.int], ['WIS', stats.wis], ['CHA', stats.cha]] as [label, val] (label)}
								<div class="border-r border-base-300 px-1 py-1.5 last:border-r-0">
									<div class="text-[9px] font-semibold uppercase tracking-wider opacity-40">{label}</div>
									<div class="text-sm font-bold {Number(val) >= 14 ? 'text-success' : Number(val) <= 8 ? 'text-error' : ''}">{val || '—'}</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Quick Stats (HP, AC from notes) -->
					{#if hp || ac}
						<div class="flex gap-3 border-b border-base-300 px-4 py-2">
							{#if hp}
								<div class="flex items-center gap-1.5">
									<span class="text-xs text-error">♥</span>
									<span class="text-xs font-semibold">{hp}</span>
									<span class="text-[10px] opacity-40">HP</span>
								</div>
							{/if}
							{#if ac}
								<div class="flex items-center gap-1.5">
									<span class="text-xs text-info">🛡</span>
									<span class="text-xs font-semibold">{ac}</span>
									<span class="text-[10px] opacity-40">AC</span>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Body -->
					<div class="flex flex-col gap-2 px-4 py-3">
						{#if m.backstoryHooks}
							<div class="text-xs">
								<span class="font-semibold opacity-60">Backstory</span>
								<p class="mt-0.5 line-clamp-2 opacity-80">{m.backstoryHooks}</p>
							</div>
						{/if}

						{#if m.relationships && m.relationships !== 'None specified'}
							<div class="text-xs">
								<span class="font-semibold opacity-60">Relationships</span>
								<p class="mt-0.5 line-clamp-2 opacity-80">{m.relationships}</p>
							</div>
						{/if}

						{#if items.length > 0}
							<div>
								<span class="text-xs font-semibold opacity-60">Equipment</span>
								<div class="mt-1 flex flex-wrap gap-1">
									{#each items.slice(0, 6) as item, i (i)}
										<span class="badge badge-outline badge-xs">{item}</span>
									{/each}
									{#if items.length > 6}
										<span class="badge badge-ghost badge-xs">+{items.length - 6} more</span>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- Footer hover indicator -->
					<div
						class="rounded-b-box border-t border-base-300 px-4 py-1.5 text-center text-[10px] opacity-0 transition-opacity group-hover:opacity-50"
					>
						Click to edit
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
