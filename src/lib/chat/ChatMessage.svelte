<script lang="ts">
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';

	interface Props {
		role: 'user' | 'assistant' | 'system';
		content: string;
		isLast?: boolean;
		isLastUser?: boolean;
		timestamp?: string;
		durationMs?: number;
		model?: string | null;
		sources?: Array<{ title: string; url: string }>;
		screenshots?: string[];
		onRegenerate?: () => void;
		onEdit?: () => void;
	}

	let {
		role,
		content,
		isLast = false,
		isLastUser = false,
		timestamp,
		durationMs,
		model,
		sources,
		screenshots,
		onRegenerate,
		onEdit
	}: Props = $props();

	function formatTime(iso: string | undefined): string {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatDuration(ms: number | undefined): string {
		if (!ms) return '';
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	function shortModel(m: string | undefined): string {
		if (!m) return '';
		// Show just the model name part after the provider prefix
		const parts = m.split('/');
		return parts.length > 1 ? parts.slice(1).join('/') : m;
	}
</script>

{#if role === 'user'}
	<div class="group chat-end chat">
		{#if timestamp}
			<div class="chat-header mb-1 text-xs opacity-40">{formatTime(timestamp)}</div>
		{/if}
		<div class="chat-bubble chat-bubble-primary whitespace-pre-wrap">{content}</div>
		{#if isLastUser && onEdit}
			<div
				class="chat-footer mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100"
			>
				<button class="btn gap-1 btn-ghost btn-xs" onclick={onEdit} title="Edit message">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-3 w-3"
					>
						<path
							d="M13.488 2.513a1.75 1.75 0 00-2.475 0L3.05 10.476a.75.75 0 00-.188.335l-.758 2.97a.5.5 0 00.608.609l2.97-.758a.75.75 0 00.336-.188l7.962-7.963a1.75 1.75 0 000-2.475l-.497-.497z"
						/>
					</svg>
					Edit
				</button>
			</div>
		{/if}
	</div>
{:else if role === 'assistant'}
	<div class="group chat-start chat">
		<div class="chat-header mb-1 flex items-center gap-2 text-xs opacity-50">
			<span>DrokBot</span>
			{#if model}<span class="opacity-70">{shortModel(model)}</span>{/if}
			{#if timestamp}<span>{formatTime(timestamp)}</span>{/if}
			{#if durationMs}<span class="opacity-70">({formatDuration(durationMs)})</span>{/if}
		</div>
		<div class="chat-bubble max-w-[85%] bg-base-300 text-base-content">
			{#if sources && sources.length > 0}
				<details class="mb-2">
					<summary class="cursor-pointer text-xs font-semibold opacity-60 select-none">
						🌐 Searched {sources.length} site{sources.length > 1 ? 's' : ''}
					</summary>
					<ul class="mt-1 flex flex-col gap-0.5">
						{#each sources as source (source.url)}
							<li class="truncate text-xs">
								<a
									href={source.url}
									target="_blank"
									rel="noopener noreferrer"
									class="link text-primary link-hover"
								>
									{source.title || new URL(source.url).hostname}
								</a>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if screenshots && screenshots.length > 0}
				<details class="mb-2">
					<summary class="cursor-pointer text-xs font-semibold opacity-60 select-none">
						📸 {screenshots.length} screenshot{screenshots.length > 1 ? 's' : ''} captured
					</summary>
					<div class="mt-2 flex flex-col gap-2">
						{#each screenshots as src, i (src)}
							<a href={src} target="_blank" rel="noopener noreferrer" class="block">
								<img
									{src}
									alt="Browser screenshot {i + 1}"
									class="max-h-64 rounded border border-base-content/10 object-contain"
								/>
							</a>
						{/each}
					</div>
				</details>
			{/if}
			<MarkdownRenderer {content} />
		</div>
		{#if isLast && onRegenerate}
			<div class="chat-footer mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
				<button
					class="btn gap-1 btn-ghost btn-xs"
					onclick={onRegenerate}
					title="Regenerate response"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						class="h-3 w-3"
					>
						<path
							fill-rule="evenodd"
							d="M13.836 2.477a.75.75 0 01.75.75v3.182a.75.75 0 01-.75.75h-3.182a.75.75 0 010-1.5h1.37l-.84-.841a4.5 4.5 0 00-7.08.681.75.75 0 01-1.3-.75 6 6 0 019.44-.908l.987.987V3.227a.75.75 0 01.75-.75zm-1.7 7.024a.75.75 0 011.3.75 6 6 0 01-9.44.907l-.986-.986v1.468a.75.75 0 01-1.5 0V8.46a.75.75 0 01.75-.75h3.182a.75.75 0 010 1.5h-1.37l.84.84a4.5 4.5 0 007.08-.681z"
							clip-rule="evenodd"
						/>
					</svg>
					Regenerate
				</button>
			</div>
		{/if}
	</div>
{/if}
