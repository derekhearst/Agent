<script lang="ts">
	import 'highlight.js/styles/github-dark.css';
	import NavMenu from '$lib/components/NavMenu.svelte';
	import SessionList from '$lib/sessions/SessionList.svelte';
	import ChatMessage from '$lib/chat/ChatMessage.svelte';
	import ChatInput from '$lib/chat/ChatInput.svelte';
	import ModelSelector from '$lib/models/ModelSelector.svelte';
	import {
		getSessions,
		getSessionMessages,
		createSession as createSessionRemote,
		updateSession as updateSessionRemote,
		deleteSession as deleteSessionRemote,
		deleteMessageAndAfter
	} from '$lib/sessions/sessions.remote';
	import { extractMemories } from '$lib/memory/memory.remote';

	interface Session {
		id: string;
		title: string;
		messageCount: number;
		model: string;
		createdAt: Date;
		updatedAt: Date;
	}

	interface Message {
		id: string;
		sessionId: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		model?: string | null;
		createdAt: string;
		durationMs?: number;
		sources?: Array<{ title: string; url: string }>;
		screenshots?: string[];
	}

	let sessions = $state<Session[]>([]);
	let activeSessionId = $state<string | null>(null);
	let messagesData = $state<Message[]>([]);
	let messages = $derived([...messagesData]);
	let isStreaming = $state(false);
	let streamingContent = $state('');
	let currentModel = $state('openrouter/auto');
	let chatContainer: HTMLDivElement | undefined = $state();
	let chatInputRef: ChatInput | undefined = $state();
	let streamStartTime = 0;
	let toolStatus = $state<{ tool: string; query: string } | null>(null);
	let searchedSources = $state<Array<{ title: string; url: string }>>([]);
	let collectedScreenshots = $state<string[]>([]);

	// Load sessions on mount
	$effect(() => {
		loadSessions();
	});

	// Auto-scroll on new content
	$effect(() => {
		// Track these to trigger scroll
		void messages.length;
		void streamingContent;
		scrollToBottom();
	});

	async function loadSessions() {
		sessions = await getSessions();
		// If we have sessions but none selected, select the first one
		if (sessions.length > 0 && !activeSessionId) {
			await selectSession(sessions[0].id);
		}
	}

	async function selectSession(id: string) {
		activeSessionId = id;
		streamingContent = '';
		isStreaming = false;

		// Load messages for this session
		const rawMessages = await getSessionMessages(id);
		messagesData = rawMessages.map((m) => ({
			...m,
			role: m.role as 'user' | 'assistant' | 'system',
			createdAt: new Date(m.createdAt).toISOString()
		}));

		// Set model from session
		const session = sessions.find((s) => s.id === id);
		if (session?.model) {
			currentModel = session.model;
		}
	}

	async function createSession() {
		const session = await createSessionRemote({ model: currentModel });
		sessions = [session, ...sessions];
		await selectSession(session.id);
	}

	async function deleteSession(id: string) {
		await deleteSessionRemote(id);
		sessions = sessions.filter((s) => s.id !== id);

		if (activeSessionId === id) {
			activeSessionId = null;
			messagesData = [];
			if (sessions.length > 0) {
				await selectSession(sessions[0].id);
			}
		}
	}

	async function handleModelChange(model: string) {
		currentModel = model;
		if (activeSessionId) {
			await updateSessionRemote({ id: activeSessionId, model });
			// Update local session
			sessions = sessions.map((s) => (s.id === activeSessionId ? { ...s, model } : s));
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
						console.error('Stream error:', parsed.error);
						streamingContent += `\n\n**Error:** ${parsed.error}`;
						break;
					}

					if (parsed.tool_status === 'searching') {
						toolStatus = {
							tool: parsed.tool,
							query: parsed.args?.query || parsed.args?.url || parsed.args?.action || ''
						};
						continue;
					}

					if (parsed.tool_status === 'complete') {
						toolStatus = null;
						if (parsed.sources && Array.isArray(parsed.sources)) {
							searchedSources = [...searchedSources, ...parsed.sources];
						}
						if (parsed.screenshots && Array.isArray(parsed.screenshots)) {
							collectedScreenshots = [...collectedScreenshots, ...parsed.screenshots];
						}
						continue;
					}

					if (parsed.content) {
						toolStatus = null;
						streamingContent += parsed.content;
					}

					if (parsed.done) {
						const durationMs = streamStartTime ? Date.now() - streamStartTime : undefined;
						const assistantMsg: Message = {
							id: parsed.messageId || crypto.randomUUID(),
							sessionId: activeSessionId!,
							role: 'assistant',
							content: streamingContent,
							model: currentModel,
							createdAt: new Date().toISOString(),
							durationMs,
							sources: searchedSources.length > 0 ? [...searchedSources] : undefined,
							screenshots: collectedScreenshots.length > 0 ? [...collectedScreenshots] : undefined
						};
						messagesData = [...messagesData, assistantMsg];
						streamingContent = '';

						if (parsed.newTitle) {
							sessions = sessions.map((s) =>
								s.id === activeSessionId ? { ...s, title: parsed.newTitle } : s
							);
						}

						sessions = sessions.map((s) =>
							s.id === activeSessionId
								? {
										...s,
										updatedAt: new Date(),
										messageCount: messages.length
									}
								: s
						);
					}
				} catch {
					// Ignore malformed JSON
				}
			}
		}
	}

	async function sendMessage(content: string) {
		if (!content.trim() || isStreaming) return;

		// Handle /remember command
		if (content.trim().toLowerCase() === '/remember') {
			if (!activeSessionId) return;

			// Show a system-style message
			const rememberMsg: Message = {
				id: crypto.randomUUID(),
				sessionId: activeSessionId,
				role: 'assistant',
				content: '🧠 Extracting memories from this conversation...',
				createdAt: new Date().toISOString()
			};
			messagesData = [...messagesData, rememberMsg];

			try {
				const result = await extractMemories({ sessionId: activeSessionId });

				const items = result.extracted || [];
				rememberMsg.content = `🧠 **Memory extraction complete!**\n\n**${result.chunksStored}** memories stored${result.filesCreated > 0 ? `, **${result.filesCreated}** note files created` : ''}.\n\n${items.length > 0 ? '**Extracted:**\n' + items.map((item: string) => `- ${item}`).join('\n') : ''}`;
				messagesData = [...messagesData]; // trigger reactivity
			} catch (error) {
				rememberMsg.content = `**Error:** ${error instanceof Error ? error.message : 'Memory extraction failed'}`;
				messagesData = [...messagesData];
			}
			return;
		}

		// Auto-create session if none exists
		if (!activeSessionId) {
			await createSession();
		}

		// Add user message to UI immediately
		const userMsg: Message = {
			id: crypto.randomUUID(),
			sessionId: activeSessionId!,
			role: 'user',
			content,
			createdAt: new Date().toISOString()
		};
		messagesData = [...messagesData, userMsg];
		isStreaming = true;
		streamingContent = '';
		toolStatus = null;
		searchedSources = [];
		collectedScreenshots = [];
		streamStartTime = Date.now();

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: activeSessionId,
					content,
					model: currentModel
				})
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Chat request failed');
			}

			await readStream(res);
		} catch (error) {
			console.error('Failed to send message:', error);
			const errorMsg: Message = {
				id: crypto.randomUUID(),
				sessionId: activeSessionId!,
				role: 'assistant',
				content: `**Error:** ${error instanceof Error ? error.message : 'Something went wrong'}`,
				createdAt: new Date().toISOString()
			};
			messagesData = [...messagesData, errorMsg];
		} finally {
			isStreaming = false;
			streamingContent = '';
			toolStatus = null;
		}
	}

	function scrollToBottom() {
		if (chatContainer) {
			// Use requestAnimationFrame to wait for DOM update
			requestAnimationFrame(() => {
				chatContainer!.scrollTop = chatContainer!.scrollHeight;
			});
		}
	}

	async function regenerateLastResponse() {
		if (isStreaming || !activeSessionId || messages.length < 2) return;

		// Find the last assistant message
		const lastAssistantIdx = messages.findLastIndex((m) => m.role === 'assistant');
		if (lastAssistantIdx === -1) return;

		const lastAssistant = messages[lastAssistantIdx];

		// Find the last user message before it
		const lastUserMsg = messages.slice(0, lastAssistantIdx).findLast((m) => m.role === 'user');
		if (!lastUserMsg) return;

		// Delete the assistant message from DB
		await deleteMessageAndAfter({ sessionId: activeSessionId, messageId: lastAssistant.id });

		// Remove from local state
		messagesData = messagesData.filter((m) => m.id !== lastAssistant.id);

		// Re-send the last user's content through the stream (without saving user msg again)
		isStreaming = true;
		streamingContent = '';
		toolStatus = null;
		searchedSources = [];
		collectedScreenshots = [];
		streamStartTime = Date.now();

		try {
			const res = await fetch('/api/chat/regenerate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: activeSessionId,
					model: currentModel
				})
			});

			if (!res.ok) {
				throw new Error('Regenerate failed');
			}

			await readStream(res);
		} catch (error) {
			console.error('Regenerate failed:', error);
			const errorMsg: Message = {
				id: crypto.randomUUID(),
				sessionId: activeSessionId!,
				role: 'assistant',
				content: `**Error:** ${error instanceof Error ? error.message : 'Regeneration failed'}`,
				createdAt: new Date().toISOString()
			};
			messagesData = [...messagesData, errorMsg];
		} finally {
			isStreaming = false;
			streamingContent = '';
			toolStatus = null;
		}
	}

	async function editLastUserMessage() {
		if (isStreaming || !activeSessionId || messages.length === 0) return;

		// Find last user message
		const lastUserMsg = messages.findLast((m) => m.role === 'user');
		if (!lastUserMsg) return;

		// Delete from this message onward
		await deleteMessageAndAfter({ sessionId: activeSessionId, messageId: lastUserMsg.id });

		// Remove from local state
		const idx = messagesData.indexOf(lastUserMsg);
		messagesData = messagesData.slice(0, idx);

		// Pre-fill the input with the old content
		if (chatInputRef) {
			chatInputRef.setValue(lastUserMsg.content);
		}
	}
</script>

<svelte:head>
	<title>DrokBot</title>
</svelte:head>

<div class="flex h-screen overflow-hidden bg-base-100">
	<!-- Left Nav -->
	<div class="w-56 shrink-0">
		<NavMenu currentRoute="/" />
	</div>

	<!-- Center Chat -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header with model selector -->
		<div class="flex items-center justify-between border-b border-base-300 px-6 py-3">
			<h2 class="text-sm font-medium opacity-70">
				{#if activeSessionId}
					{sessions.find((s) => s.id === activeSessionId)?.title || 'Chat'}
				{:else}
					New Chat
				{/if}
			</h2>
			<ModelSelector {currentModel} onModelChange={handleModelChange} />
		</div>

		<!-- Messages -->
		<div class="flex-1 overflow-y-auto px-4 py-4" bind:this={chatContainer}>
			<div class="mx-auto max-w-3xl">
				{#if messages.length === 0 && !isStreaming}
					<div class="flex h-full items-center justify-center pt-32">
						<div class="text-center">
							<div class="mb-4 text-6xl opacity-20">🤖</div>
							<h2 class="mb-2 text-xl font-semibold opacity-60">How can I help you?</h2>
							<p class="text-sm opacity-40">Send a message to start a conversation</p>
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						{#each messages as msg, i (msg.id)}
							{@const isLastAssistant =
								msg.role === 'assistant' &&
								i === messages.findLastIndex((m) => m.role === 'assistant')}
							{@const isLastUser =
								msg.role === 'user' && i === messages.findLastIndex((m) => m.role === 'user')}
							<ChatMessage
								role={msg.role}
								content={msg.content}
								isLast={isLastAssistant}
								{isLastUser}
								timestamp={msg.createdAt}
								durationMs={msg.durationMs}
								model={msg.model}
								sources={msg.sources}
								screenshots={msg.screenshots}
								onRegenerate={isLastAssistant && !isStreaming ? regenerateLastResponse : undefined}
								onEdit={isLastUser && !isStreaming ? editLastUserMessage : undefined}
							/>
						{/each}

						{#if isStreaming && toolStatus}
							<div class="chat-start chat">
								<div class="chat-bubble flex items-center gap-2 bg-base-300 text-base-content">
									<span class="loading loading-sm loading-spinner"></span>
									<span class="text-sm">
										{#if toolStatus.tool.startsWith('browse') || toolStatus.tool.startsWith('browser')}
											🌐 Browsing{toolStatus.query ? ` "${toolStatus.query}"` : ''}...
										{:else}
											🔍 Searching the web{toolStatus.query ? ` for "${toolStatus.query}"` : ''}...
										{/if}
									</span>
								</div>
							</div>
						{/if}

						{#if isStreaming && streamingContent}
							<ChatMessage
								role="assistant"
								content={streamingContent}
								sources={searchedSources.length > 0 ? searchedSources : undefined}
								screenshots={collectedScreenshots.length > 0 ? collectedScreenshots : undefined}
							/>
						{/if}

						{#if isStreaming && !streamingContent && !toolStatus}
							<div class="chat-start chat">
								<div class="chat-bubble bg-base-300 text-base-content">
									<span class="loading loading-sm loading-dots"></span>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Input -->
		<div class="mx-auto w-full max-w-3xl">
			<ChatInput disabled={isStreaming} onSend={sendMessage} bind:this={chatInputRef} />
		</div>
	</div>

	<!-- Right Sidebar - Sessions -->
	<div class="w-64 shrink-0 border-l border-base-300">
		<SessionList
			{sessions}
			{activeSessionId}
			onSelect={selectSession}
			onNew={createSession}
			onDelete={deleteSession}
		/>
	</div>
</div>
