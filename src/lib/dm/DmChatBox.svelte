<script lang="ts">
	import 'highlight.js/styles/github-dark.css';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import ChatMessage from '$lib/chat/ChatMessage.svelte';
	import ChatInput from '$lib/chat/ChatInput.svelte';
	import { getSessionMessages } from '$lib/sessions/sessions.remote';

	interface Props {
		campaignId: string;
		sessionId?: string; // chat sessionId
		dmSessionId?: string; // DM session id
		model?: string;
	}

	let { campaignId, sessionId, dmSessionId, model = 'moonshotai/kimi-k2.5' }: Props = $props();

	interface Message {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		model?: string | null;
		createdAt: string;
		toolsUsed?: Array<{ tool: string; args: Record<string, unknown>; durationMs: number }>;
	}

	let messages = $state<Message[]>([]);
	let isStreaming = $state(false);
	let streamingContent = $state('');
	let isLoadingHistory = $state(false);
	let chatContainer: HTMLDivElement | undefined = $state();

	// Load existing messages on mount
	$effect(() => {
		if (sessionId) {
			loadHistory();
		}
	});

	async function loadHistory() {
		isLoadingHistory = true;
		try {
			const existing = await getSessionMessages(sessionId!);
			messages = existing
				.filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
				.map(
					(m: {
						id: string;
						role: string;
						content: string;
						model?: string | null;
						createdAt: string | Date;
					}) => ({
						id: m.id,
						role: m.role as 'user' | 'assistant',
						content: m.content,
						model: m.model,
						createdAt:
							typeof m.createdAt === 'string' ? m.createdAt : new Date(m.createdAt).toISOString()
					})
				);
		} catch (err) {
			console.error('Failed to load chat history:', err);
		} finally {
			isLoadingHistory = false;
		}
	}
	let toolActivity = $state<
		Array<{
			tool: string;
			args: Record<string, unknown>;
			status: 'running' | 'done';
			startedAt: number;
			finishedAt?: number;
		}>
	>([]);

	// Auto-scroll
	$effect(() => {
		void messages.length;
		void streamingContent;
		if (chatContainer) {
			requestAnimationFrame(() => {
				chatContainer!.scrollTop = chatContainer!.scrollHeight;
			});
		}
	});

	function getDmToolSummary(): string {
		if (toolActivity.length === 0) return '';
		const current =
			toolActivity.findLast((t) => t.status === 'running') || toolActivity[toolActivity.length - 1];
		const tool = current.tool;
		switch (tool) {
			case 'dm_search_lore':
				return 'Searching source books...';
			case 'dm_adjust_reputation':
				return 'Adjusting faction reputation...';
			case 'dm_log_consequence':
				return 'Logging butterfly effect...';
			case 'dm_update_npc':
				return 'Updating NPC...';
			case 'dm_update_quest':
				return 'Updating quest...';
			case 'dm_update_item':
				return 'Updating item...';
			case 'dm_update_party':
				return 'Updating party...';
			case 'dm_get_campaign_state':
				return 'Reading campaign state...';
			case 'dm_get_session_recaps':
				return 'Reviewing past sessions...';
			case 'dm_generate_contextual_loot':
				return 'Generating loot...';
			case 'dm_npc_rumor_check':
				return 'Checking NPC rumors...';
			case 'recall_memory':
				return 'Searching memory...';
			case 'search_web':
				return 'Searching the web...';
			default:
				return `Using ${tool}...`;
		}
	}

	async function readStream(res: Response) {
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const data = line.slice(6).trim();
				if (!data) continue;

				try {
					const parsed = JSON.parse(data);

					if (parsed.error) {
						streamingContent += `\n\n**Error:** ${parsed.error}`;
						break;
					}

					if (parsed.tool_status === 'searching') {
						toolActivity = [
							...toolActivity,
							{
								tool: parsed.tool,
								args: parsed.args || {},
								status: 'running',
								startedAt: Date.now()
							}
						];
						continue;
					}

					if (parsed.tool_status === 'complete') {
						const idx = toolActivity.findLastIndex(
							(t) => t.tool === parsed.tool && t.status === 'running'
						);
						if (idx !== -1) {
							toolActivity[idx].status = 'done';
							toolActivity[idx].finishedAt = Date.now();
							toolActivity = [...toolActivity];
						}
						continue;
					}

					if (parsed.content) {
						streamingContent += parsed.content;
					}

					if (parsed.done) {
						const assistantMsg: Message = {
							id: parsed.messageId || crypto.randomUUID(),
							role: 'assistant',
							content: streamingContent,
							model,
							createdAt: new Date().toISOString(),
							toolsUsed:
								toolActivity.length > 0
									? toolActivity.map((t) => ({
											tool: t.tool,
											args: t.args,
											durationMs: (t.finishedAt || Date.now()) - t.startedAt
										}))
									: undefined
						};
						messages = [...messages, assistantMsg];
						streamingContent = '';
					}
				} catch {
					/* ignore malformed */
				}
			}
		}
	}

	async function sendMessage(content: string) {
		if (!content.trim() || isStreaming) return;

		const userMsg: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content,
			createdAt: new Date().toISOString()
		};
		messages = [...messages, userMsg];
		isStreaming = true;
		streamingContent = '';
		toolActivity = [];

		try {
			const res = await fetch('/api/dm/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					campaignId,
					sessionId,
					dmSessionId,
					content,
					model
				})
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'DM chat request failed');
			}

			await readStream(res);
		} catch (error) {
			const errorMsg: Message = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: `**Error:** ${error instanceof Error ? error.message : 'Something went wrong'}`,
				createdAt: new Date().toISOString()
			};
			messages = [...messages, errorMsg];
		} finally {
			isStreaming = false;
			streamingContent = '';
			toolActivity = [];
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Messages area -->
	<div class="flex-1 overflow-y-auto p-4" bind:this={chatContainer}>
		{#if isLoadingHistory}
			<div class="flex items-center justify-center py-12">
				<span class="loading loading-sm loading-spinner"></span>
				<span class="ml-2 text-sm opacity-50">Loading history...</span>
			</div>
		{:else if messages.length === 0 && !streamingContent}
			<div class="flex flex-col items-center justify-center py-12 text-center opacity-50">
				<div class="mb-2 text-4xl">🎲</div>
				<p class="text-sm">Ask your DM assistant anything about the campaign.</p>
				<p class="text-xs opacity-60">
					Rules lookups, NPC roleplay, encounter building, lore search...
				</p>
			</div>
		{/if}

		{#each messages as msg, i (msg.id)}
			<ChatMessage
				role={msg.role}
				content={msg.content}
				isLast={i === messages.length - 1 && !streamingContent}
				model={msg.model}
				toolsUsed={msg.toolsUsed}
			/>
		{/each}

		{#if streamingContent || isStreaming}
			<div class="chat-start chat">
				{#if toolActivity.some((t) => t.status === 'running')}
					<div class="mb-2 flex items-center gap-2 text-xs opacity-60">
						<span class="loading loading-xs loading-dots"></span>
						{getDmToolSummary()}
					</div>
				{/if}
				{#if streamingContent}
					<div class="prose-sm chat-bubble prose max-w-none">
						<MarkdownRenderer content={streamingContent} />
					</div>
				{:else if isStreaming && !toolActivity.some((t) => t.status === 'running')}
					<div class="chat-bubble">
						<span class="loading loading-sm loading-dots"></span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Input area -->
	<ChatInput disabled={isStreaming} onSend={sendMessage} />
</div>
