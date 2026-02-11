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
		toolsUsed?: Array<{ tool: string; args: Record<string, unknown>; durationMs: number }>;
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
		toolsUsed,
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

	function getToolIcon(tool: string): string {
		if (
			tool.startsWith('search_email') ||
			tool.startsWith('read_email') ||
			tool.startsWith('list_email')
		)
			return '📧';
		if (tool.startsWith('list_calendar') || tool.startsWith('check_availability')) return '📅';
		if (tool === 'search_web') return '🔍';
		if (tool === 'recall_memory' || tool === 'save_memory') return '🧠';
		if (
			tool.startsWith('create_note') ||
			tool.startsWith('read_note') ||
			tool.startsWith('list_note')
		)
			return '📝';
		if (tool === 'get_finances') return '💰';
		if (tool.startsWith('browse') || tool.startsWith('browser')) return '🌐';
		if (tool.startsWith('ask_agent') || tool.startsWith('list_agent')) return '🤖';
		return '⚙️';
	}

	function getToolShortLabel(tool: string, args: Record<string, unknown>): string {
		const short = (s: string, max = 50) => (s.length > max ? s.slice(0, max) + '…' : s);
		switch (tool) {
			case 'search_email':
				return `Search email: "${short((args.query as string) || '')}"`;
			case 'read_email':
				return `Read email ${args.message_id || ''}`;
			case 'list_emails':
				return `List ${args.label || 'INBOX'} emails`;
			case 'list_calendar_events':
				return `Calendar (next ${args.days_ahead || 7} days)`;
			case 'check_availability':
				return `Availability: ${args.date || ''}`;
			case 'search_web':
				return `Web search: "${short((args.query as string) || '')}"`;
			case 'recall_memory':
				return `Memory search: "${short((args.query as string) || '')}"`;
			case 'save_memory':
				return 'Save to memory';
			case 'get_finances':
				return `Finances${args.month ? ` (${args.month})` : ''}`;
			case 'browse_url':
				return `Browse: ${short((args.url as string) || '')}`;
			default:
				return tool;
		}
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
			{#if toolsUsed && toolsUsed.length > 0}
				<div class="dropdown dropdown-bottom">
					<div
						tabindex="0"
						role="button"
						class="flex cursor-pointer items-center gap-1.5 rounded-full bg-base-200/50 px-2 py-0.5 select-none hover:bg-base-200"
					>
						<svg class="h-3 w-3 text-warning" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
							/>
						</svg>
						<span class="text-base-content/80"
							>Used {toolsUsed.length} tool{toolsUsed.length > 1 ? 's' : ''}</span
						>
						<svg class="h-3 w-3 text-base-content/50" viewBox="0 0 20 20" fill="currentColor">
							<path
								fill-rule="evenodd"
								d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<div
						tabindex="0"
						class="dropdown-content z-50 mt-1 max-w-md min-w-max rounded-lg border border-base-300 bg-base-100 p-1.5 shadow-xl"
					>
						{#each toolsUsed as entry, i (i)}
							<div class="flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-base-200">
								<span class="text-xs text-success">✓</span>
								<span class="text-sm">{getToolIcon(entry.tool)}</span>
								<span class="flex-1 text-base-content"
									>{getToolShortLabel(entry.tool, entry.args)}</span
								>
								<span class="text-base-content/50">{(entry.durationMs / 1000).toFixed(1)}s</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
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
