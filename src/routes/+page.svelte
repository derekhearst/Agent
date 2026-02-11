<script lang="ts">
	import 'highlight.js/styles/github-dark.css';
	import NavMenu from '$lib/components/NavMenu.svelte';
	import GeometricPattern from '$lib/components/GeometricPattern.svelte';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
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
		toolsUsed?: Array<{
			tool: string;
			args: Record<string, unknown>;
			durationMs: number;
		}>;
	}

	let sessions = $state<Session[]>([]);
	let activeSessionId = $state<string | null>(null);
	let messagesData = $state<Message[]>([]);
	let messages = $derived([...messagesData]);
	let isStreaming = $state(false);
	let streamingContent = $state('');
	let currentModel = $state('moonshotai/kimi-k2.5');
	let chatContainer: HTMLDivElement | undefined = $state();
	let chatInputRef: ChatInput | undefined = $state();
	let streamStartTime = 0;
	let toolActivity = $state<
		Array<{
			tool: string;
			args: Record<string, unknown>;
			status: 'running' | 'done';
			startedAt: number;
			finishedAt?: number;
		}>
	>([]);
	let searchedSources = $state<Array<{ title: string; url: string }>>([]);
	let collectedScreenshots = $state<string[]>([]);

	/** Generate a short human-readable summary of what tools are doing */
	function getToolSummary(
		activity: Array<{ tool: string; args: Record<string, unknown>; status: string }>
	): string {
		if (activity.length === 0) return '';

		// Find the most significant/recent running tool, or the last one
		const current =
			activity.findLast((t) => t.status === 'running') || activity[activity.length - 1];
		const tool = current.tool;
		const args = current.args;

		// Generate a short contextual summary
		switch (tool) {
			case 'search_email':
			case 'list_emails':
			case 'read_email': {
				const readCount = activity.filter((t) => t.tool === 'read_email').length;
				const q = (activity.find((t) => t.tool === 'search_email')?.args?.query as string) || '';
				if (readCount > 0)
					return `Analyzing ${readCount} email${readCount > 1 ? 's' : ''}${q ? ` — ${q}` : ''}`;
				if (q) return `Searching emails: ${q}`;
				return 'Reading emails';
			}
			case 'list_calendar_events':
			case 'check_availability':
				return 'Checking calendar';
			case 'search_web':
				return `Searching the web${args.query ? `: ${args.query}` : ''}`;
			case 'recall_memory':
			case 'save_memory':
			case 'create_note':
			case 'read_note':
			case 'list_notes':
				return 'Accessing memory';
			case 'get_finances':
				return 'Checking finances';
			case 'browse_url':
			case 'browser_act':
			case 'browser_extract':
			case 'browser_screenshot':
				return 'Browsing the web';
			case 'ask_agent':
				return `Consulting agent: ${args.agent_name || ''}`;
			default:
				return `Using ${tool}`;
		}
	}

	function getToolLabel(
		tool: string,
		args: Record<string, unknown>
	): { icon: string; text: string } {
		const q = (args.query as string) || '';
		const short = (s: string, max = 40) => (s.length > max ? s.slice(0, max) + '…' : s);

		switch (tool) {
			case 'search_email':
				return { icon: '📧', text: `Searching email${q ? `: "${short(q)}"` : ''}` };
			case 'read_email':
				return { icon: '📧', text: `Reading email ${args.message_id || ''}` };
			case 'list_emails':
				return {
					icon: '📧',
					text: `Listing ${args.label || 'INBOX'} emails${args.unread_only ? ' (unread)' : ''}`
				};
			case 'list_calendar_events':
				return {
					icon: '📅',
					text: `Checking calendar (next ${args.days_ahead || 7} days)`
				};
			case 'check_availability':
				return { icon: '📅', text: `Checking availability for ${args.date || ''}` };
			case 'search_web':
				return { icon: '🔍', text: `Searching web${q ? `: "${short(q)}"` : ''}` };
			case 'recall_memory':
				return { icon: '🧠', text: `Searching memory${q ? `: "${short(q)}"` : ''}` };
			case 'save_memory':
				return { icon: '💾', text: 'Saving to memory' };
			case 'create_note':
				return { icon: '📝', text: `Writing note: ${args.path || ''}` };
			case 'read_note':
				return { icon: '📖', text: `Reading note: ${args.path || ''}` };
			case 'list_notes':
				return { icon: '📂', text: 'Browsing notes' };
			case 'get_finances':
				return { icon: '💰', text: `Checking finances${args.month ? ` (${args.month})` : ''}` };
			case 'browse_url':
				return { icon: '🌐', text: `Browsing: ${short((args.url as string) || '')}` };
			case 'browser_act':
				return {
					icon: '🖱️',
					text: `${args.action || 'Acting'}${args.target ? `: "${short(args.target as string)}"` : ''}`
				};
			case 'browser_extract':
				return { icon: '📋', text: 'Extracting page content' };
			case 'browser_screenshot':
				return { icon: '📸', text: 'Taking screenshot' };
			case 'browser_close':
				return { icon: '❌', text: 'Closing browser' };
			case 'ask_agent':
				return { icon: '🤖', text: `Asking agent: ${args.agent_name || ''}` };
			case 'list_agents':
				return { icon: '🤖', text: 'Listing agents' };
			default:
				return { icon: '⚙️', text: `${tool}${q ? `: "${short(q)}"` : ''}` };
		}
	}

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
		// Optimistic update - create a temporary session immediately
		const tempId = `temp-${Date.now()}`;
		const tempSession: Session = {
			id: tempId,
			title: 'New Chat',
			messageCount: 0,
			model: currentModel,
			createdAt: new Date(),
			updatedAt: new Date()
		};
		sessions = [tempSession, ...sessions];
		activeSessionId = tempId;
		messagesData = [];

		// Create the real session in the background
		const session = await createSessionRemote({ model: currentModel });

		// Replace temp session with real one
		sessions = sessions.map((s) => (s.id === tempId ? session : s));
		activeSessionId = session.id;
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
		console.log('handleModelChange called with:', model);
		currentModel = model;
		console.log('currentModel set to:', currentModel);
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
						// Mark the last running instance of this tool as done
						const idx = toolActivity.findLastIndex(
							(t) => t.tool === parsed.tool && t.status === 'running'
						);
						if (idx !== -1) {
							toolActivity[idx].status = 'done';
							toolActivity[idx].finishedAt = Date.now();
							toolActivity = [...toolActivity];
						}
						if (parsed.sources && Array.isArray(parsed.sources)) {
							searchedSources = [...searchedSources, ...parsed.sources];
						}
						if (parsed.screenshots && Array.isArray(parsed.screenshots)) {
							collectedScreenshots = [...collectedScreenshots, ...parsed.screenshots];
						}
						continue;
					}

					if (parsed.content) {
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
							screenshots: collectedScreenshots.length > 0 ? [...collectedScreenshots] : undefined,
							toolsUsed:
								toolActivity.length > 0
									? toolActivity.map((t) => ({
											tool: t.tool,
											args: t.args,
											durationMs: (t.finishedAt || Date.now()) - t.startedAt
										}))
									: undefined
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
		toolActivity = [];
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
			toolActivity = [];
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

		// Set streaming state FIRST for immediate UI feedback
		isStreaming = true;
		streamingContent = '';
		toolActivity = [];
		searchedSources = [];
		collectedScreenshots = [];
		streamStartTime = Date.now();

		// Remove from local state immediately for snappy UI
		messagesData = messagesData.filter((m) => m.id !== lastAssistant.id);

		// Delete from DB in background (don't await)
		deleteMessageAndAfter({ sessionId: activeSessionId, messageId: lastAssistant.id }).catch(
			(err) => console.error('Failed to delete message:', err)
		);

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
			toolActivity = [];
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
	<div class="relative flex min-w-0 flex-1 flex-col">
		<!-- Background Pattern - covers entire chat area -->
		<GeometricPattern
			variant="hexagons"
			opacity={messages.length === 0 && !isStreaming ? 0.04 : 0.02}
		/>

		<!-- Header -->
		<div class="relative z-20 flex items-center justify-between border-b border-base-300 px-4 py-3">
			<div>
				<h1 class="text-lg font-semibold">
					{#if activeSessionId}
						{sessions.find((s) => s.id === activeSessionId)?.title || 'Chat'}
					{:else}
						New Chat
					{/if}
				</h1>
				<p class="text-sm opacity-50">
					{messages.length} message{messages.length !== 1 ? 's' : ''}
				</p>
			</div>
			<ModelSelector {currentModel} onModelChange={handleModelChange} />
		</div>

		<!-- Messages -->
		<div class="relative z-10 flex-1 overflow-y-auto px-4 py-4" bind:this={chatContainer}>
			<div class="mx-auto max-w-3xl">
				{#if messages.length === 0 && !isStreaming}
					<div class="flex h-full items-center justify-center pt-32">
						<div class="relative z-10 text-center">
							<div class="mb-4 text-6xl">🤖</div>
							<h2
								class="mb-2 bg-linear-to-r from-primary via-secondary to-accent bg-clip-text text-2xl font-bold text-transparent"
							>
								How can I help you?
							</h2>
							<p class="text-sm opacity-50">Send a message to start a conversation</p>
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
								toolsUsed={msg.toolsUsed}
								onRegenerate={isLastAssistant && !isStreaming ? regenerateLastResponse : undefined}
								onEdit={isLastUser && !isStreaming ? editLastUserMessage : undefined}
							/>
						{/each}

						{#if isStreaming}
							{@const summary = getToolSummary(toolActivity)}
							{@const runningCount = toolActivity.filter((t) => t.status === 'running').length}
							<div class="chat-start chat">
								<div class="chat-header mb-1 flex items-center gap-2 text-xs opacity-50">
									<span>DrokBot</span>
									{#if toolActivity.length > 0}
										<div class="dropdown dropdown-bottom">
											<button
												type="button"
												class="flex cursor-pointer items-center gap-1.5 rounded-full bg-base-200/50 px-2 py-0.5 select-none hover:bg-base-200"
											>
												{#if runningCount > 0}
													<span class="loading loading-xs loading-spinner text-warning"></span>
												{:else}
													<svg class="h-3 w-3 text-warning" viewBox="0 0 24 24" fill="currentColor">
														<path
															d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
														/>
													</svg>
												{/if}
												<span class="font-medium text-base-content/70"
													>{summary ||
														`${toolActivity.length} tool${toolActivity.length > 1 ? 's' : ''}`}</span
												>
												<svg
													class="h-3 w-3 text-base-content/40"
													viewBox="0 0 20 20"
													fill="currentColor"
												>
													<path
														fill-rule="evenodd"
														d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
														clip-rule="evenodd"
													/>
												</svg>
											</button>
											<div
												class="dropdown-content z-50 mt-1 max-w-md min-w-max rounded-lg border border-base-300 bg-base-100 p-1.5 shadow-xl"
											>
												{#each toolActivity as entry, i (i)}
													{@const label = getToolLabel(entry.tool, entry.args)}
													{@const elapsed = entry.finishedAt
														? ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1)
														: ((Date.now() - entry.startedAt) / 1000).toFixed(0)}
													<div
														class="flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-base-200"
													>
														{#if entry.status === 'running'}
															<span class="loading loading-xs loading-spinner text-primary"></span>
														{:else}
															<span class="text-xs text-success">✓</span>
														{/if}
														<span class="text-sm">{label.icon}</span>
														<span
															class="flex-1 text-base-content"
															class:opacity-60={entry.status === 'done'}>{label.text}</span
														>
														<span class="text-base-content/50">{elapsed}s</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
								</div>
								<div class="chat-bubble max-w-[85%] bg-base-300 text-base-content">
									{#if streamingContent}
										{#if searchedSources.length > 0}
											<details class="mb-2">
												<summary
													class="cursor-pointer text-xs font-semibold opacity-60 select-none"
												>
													🌐 Searched {searchedSources.length} site{searchedSources.length > 1
														? 's'
														: ''}
												</summary>
												<ul class="mt-1 flex flex-col gap-0.5">
													{#each searchedSources as source (source.url)}
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
										{#if collectedScreenshots.length > 0}
											<details class="mb-2">
												<summary
													class="cursor-pointer text-xs font-semibold opacity-60 select-none"
												>
													📸 {collectedScreenshots.length} screenshot{collectedScreenshots.length >
													1
														? 's'
														: ''} captured
												</summary>
												<div class="mt-2 flex flex-col gap-2">
													{#each collectedScreenshots as src, i (src)}
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
										<MarkdownRenderer content={streamingContent} />
									{:else if toolActivity.length > 0 && runningCount > 0}
										<div class="flex items-center gap-2 text-sm opacity-60">
											<span class="loading loading-sm loading-dots"></span>
											<span>Working...</span>
										</div>
									{:else}
										<span class="loading loading-sm loading-dots"></span>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Input -->
		<div class="relative z-10 mx-auto w-full max-w-3xl">
			<ChatInput disabled={isStreaming} onSend={sendMessage} bind:this={chatInputRef} />
		</div>
	</div>

	<!-- Right Sidebar - Sessions -->
	<div class="w-64 shrink-0 overflow-hidden border-l border-base-300">
		<SessionList
			{sessions}
			{activeSessionId}
			onSelect={selectSession}
			onNew={createSession}
			onDelete={deleteSession}
		/>
	</div>
</div>
