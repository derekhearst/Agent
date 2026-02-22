<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import { exportCampaign, importCampaign } from '$lib/dm/dm.remote';
	import { goto } from '$app/navigation';

	interface Props {
		campaignId: string;
		campaignName: string;
	}

	let { campaignId, campaignName }: Props = $props();

	let exporting = $state(false);
	let importing = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	async function handleExport() {
		exporting = true;
		try {
			const data = await exportCampaign(campaignId);
			const json = JSON.stringify(data, null, 2);
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${campaignName.replace(/[^a-zA-Z0-9]/g, '_')}_export.json`;
			a.click();
			URL.revokeObjectURL(url);
			Pop.success('Campaign exported!');
		} catch (err) {
			console.error(err);
			Pop.error('Export failed');
		} finally {
			exporting = false;
		}
	}

	async function handleImportClick() {
		fileInput?.click();
	}

	async function handleFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const confirmed = await Pop.confirm(
			`Import campaign from "${file.name}"? This creates a NEW campaign.`
		);
		if (!confirmed) return;

		importing = true;
		try {
			const text = await file.text();
			// Validate JSON
			JSON.parse(text);
			const campaign = await importCampaign(text);
			Pop.success('Campaign imported!');
			await goto(`/dm/${campaign.id}`);
		} catch (err) {
			console.error(err);
			Pop.error('Import failed — check file format');
		} finally {
			importing = false;
			if (input) input.value = '';
		}
	}
</script>

<div class="flex flex-wrap gap-2">
	<button class="btn btn-outline btn-sm" onclick={handleExport} disabled={exporting}>
		{#if exporting}<span class="loading loading-xs loading-spinner"></span>{:else}📤{/if} Export
	</button>
	<button class="btn btn-outline btn-sm" onclick={handleImportClick} disabled={importing}>
		{#if importing}<span class="loading loading-xs loading-spinner"></span>{:else}📥{/if} Import
	</button>
	<input
		type="file"
		accept=".json"
		class="hidden"
		bind:this={fileInput}
		onchange={handleFileSelected}
	/>
</div>
