<script lang="ts">
	import { Pop } from '$lib/dm/pop';
	import { ruleLookup } from '$lib/dm/dm.remote';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';

	interface Props {
		campaignId: string;
	}

	let { campaignId }: Props = $props();

	let question = $state('');
	let answer = $state('');
	let searching = $state(false);
	let history = $state<{ q: string; a: string }[]>([]);

	async function handleSearch() {
		const q = question.trim();
		if (!q) return;
		searching = true;
		answer = '';
		try {
			const result = await ruleLookup({ campaignId, question: q });
			answer = result.answer;
			history = [{ q, a: answer }, ...history.slice(0, 9)];
		} catch (err) {
			console.error(err);
			Pop.error('Lookup failed');
		} finally {
			searching = false;
		}
	}
</script>

<div class="rounded-box border border-base-300 bg-base-200 p-4">
	<h3 class="mb-2 text-sm font-semibold">📖 Rule Quick-Lookup</h3>
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			handleSearch();
		}}
	>
		<input
			type="text"
			class="input-bordered input input-sm flex-1"
			placeholder="e.g. How does concentration work?"
			bind:value={question}
		/>
		<button class="btn btn-sm btn-primary" type="submit" disabled={searching || !question.trim()}>
			{#if searching}<span class="loading loading-xs loading-spinner"></span>{:else}Search{/if}
		</button>
	</form>

	{#if answer}
		<div class="mt-3 rounded-lg border border-info/20 bg-base-100 p-3">
			<MarkdownRenderer content={answer} />
		</div>
	{/if}

	{#if history.length > 1}
		<details class="mt-3">
			<summary class="cursor-pointer text-xs opacity-50"
				>Previous lookups ({history.length - 1})</summary
			>
			<div class="mt-2 flex flex-col gap-2">
				{#each history.slice(1) as h (h.q)}
					<div class="rounded border border-base-300 p-2">
						<p class="text-xs font-semibold opacity-60">{h.q}</p>
						<div class="mt-1 text-xs">
							<MarkdownRenderer content={h.a} />
						</div>
					</div>
				{/each}
			</div>
		</details>
	{/if}

	<p class="mt-2 text-xs opacity-40">Searches your vectorized source books with AI summarization</p>
</div>
