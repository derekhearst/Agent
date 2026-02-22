<script lang="ts">
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';

	interface Props {
		dmRecap: string | null;
		playerRecap: string | null;
		nextSessionHooks: string; // JSON array
		prepContent: string | null;
	}

	let { dmRecap, playerRecap, nextSessionHooks, prepContent }: Props = $props();

	let activeTab = $state<'prep' | 'dm' | 'player' | 'hooks'>('prep');
	let copied = $state(false);

	function parseHooks(json: string): string[] {
		try {
			return JSON.parse(json);
		} catch {
			return [];
		}
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// fallback
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div role="tablist" class="tabs-boxed tabs tabs-sm">
		{#if prepContent}
			<button
				role="tab"
				class="tab"
				class:tab-active={activeTab === 'prep'}
				onclick={() => (activeTab = 'prep')}>📋 Session Prep</button
			>
		{/if}
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'dm'}
			onclick={() => (activeTab = 'dm')}
			disabled={!dmRecap}>🎭 DM Recap</button
		>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'player'}
			onclick={() => (activeTab = 'player')}
			disabled={!playerRecap}>📜 Player Recap</button
		>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'hooks'}
			onclick={() => (activeTab = 'hooks')}>🪝 Next Hooks</button
		>
	</div>

	<div class="rounded-box border border-base-300 bg-base-100 p-4">
		{#if activeTab === 'prep'}
			{#if prepContent}
				<div class="prose-sm prose max-w-none">
					<MarkdownRenderer content={prepContent} />
				</div>
			{:else}
				<p class="text-sm opacity-50">Session prep not generated yet.</p>
			{/if}
		{:else if activeTab === 'dm'}
			{#if dmRecap}
				<div class="prose-sm prose max-w-none">
					<MarkdownRenderer content={dmRecap} />
				</div>
			{:else}
				<p class="text-sm opacity-50">DM recap will be generated when the session ends.</p>
			{/if}
		{:else if activeTab === 'player'}
			{#if playerRecap}
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs opacity-50">Share this with your players — spoiler-free!</span>
					<button class="btn gap-1 btn-outline btn-xs" onclick={() => copyToClipboard(playerRecap)}>
						{copied ? '✓ Copied!' : '📋 Copy for Players'}
					</button>
				</div>
				<div class="prose-sm prose max-w-none">
					<MarkdownRenderer content={playerRecap} />
				</div>
			{:else}
				<p class="text-sm opacity-50">Player recap will be generated when the session ends.</p>
			{/if}
		{:else if activeTab === 'hooks'}
			{@const parsedHooks = parseHooks(nextSessionHooks)}
			{#if parsedHooks.length > 0}
				<div class="flex flex-col gap-2">
					{#each parsedHooks as hook, i (i)}
						<div class="flex items-start gap-2 rounded-lg bg-base-200 p-3">
							<span class="badge badge-sm badge-primary">{i + 1}</span>
							<span class="text-sm">{hook}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm opacity-50">Hooks will be generated when the session ends.</p>
			{/if}
		{/if}
	</div>
</div>
