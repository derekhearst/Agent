<script lang="ts">
	import { Marked } from 'marked';
	import hljs from 'highlight.js';

	interface Props {
		content: string;
	}

	let { content }: Props = $props();

	const marked = new Marked({
		renderer: {
			code({ text, lang }: { text: string; lang?: string }) {
				const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
				const highlighted = hljs.highlight(text, { language }).value;
				return `<div class="relative group my-1">
					<div class="flex items-center justify-between bg-base-300 px-2 py-0.5 rounded-t text-xs text-base-content/60">
						<span>${language}</span>
						<button class="btn btn-ghost btn-xs copy-btn" onclick="navigator.clipboard.writeText(this.closest('.group').querySelector('code').textContent).then(() => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy', 1500) })">Copy</button>
					</div>
					<pre class="bg-base-300/50 rounded-b py-1.5 overflow-x-auto m-0"><code class="hljs language-${language}">${highlighted}</code></pre>
				</div>`;
			}
		}
	});

	let html = $derived(marked.parse(content) as string);
</script>

<div class="markdown-content prose max-w-none text-sm text-current">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>

<style>
	.markdown-content {
		--tw-prose-body: currentColor;
		--tw-prose-headings: currentColor;
		--tw-prose-bold: currentColor;
		--tw-prose-links: oklch(var(--p));
		--tw-prose-counters: currentColor;
		--tw-prose-bullets: currentColor;
	}
	.markdown-content :global(p) {
		margin-bottom: 0.5em;
	}
	.markdown-content :global(p:last-child) {
		margin-bottom: 0;
	}
	.markdown-content :global(h1) {
		font-size: 1.5em;
		font-weight: 700;
		margin: 0.75em 0 0.5em;
	}
	.markdown-content :global(h2) {
		font-size: 1.3em;
		font-weight: 700;
		margin: 0.75em 0 0.4em;
	}
	.markdown-content :global(h3) {
		font-size: 1.15em;
		font-weight: 600;
		margin: 0.6em 0 0.3em;
	}
	.markdown-content :global(h4),
	.markdown-content :global(h5),
	.markdown-content :global(h6) {
		font-size: 1em;
		font-weight: 600;
		margin: 0.5em 0 0.25em;
	}
	.markdown-content :global(h1:first-child),
	.markdown-content :global(h2:first-child),
	.markdown-content :global(h3:first-child),
	.markdown-content :global(h4:first-child) {
		margin-top: 0;
	}
	.markdown-content :global(ul),
	.markdown-content :global(ol) {
		margin-left: 1.5em;
		margin-bottom: 0.5em;
	}
	.markdown-content :global(ul) {
		list-style-type: disc;
	}
	.markdown-content :global(ol) {
		list-style-type: decimal;
	}
	.markdown-content :global(li) {
		margin-bottom: 0.25em;
	}
	.markdown-content :global(pre) {
		margin: 0;
	}
	.markdown-content :global(code:not(pre code)) {
		background: oklch(var(--b3));
		padding: 0.15em 0.4em;
		border-radius: 0.25em;
		font-size: 0.875em;
	}
	/* Let highlight.js control all colors inside code blocks */
	.markdown-content :global(pre) {
		color: unset;
	}
	.markdown-content :global(pre code) {
		color: unset;
	}
	.markdown-content :global(blockquote) {
		border-left: 3px solid oklch(var(--p));
		padding-left: 1em;
		margin: 0.5em 0;
		opacity: 0.85;
	}
	.markdown-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.5em 0;
		border: 1px solid currentColor;
		opacity: 0.8;
	}
	.markdown-content :global(th),
	.markdown-content :global(td) {
		border: 1px solid currentColor;
		padding: 0.4em 0.8em;
		text-align: left;
	}
	.markdown-content :global(th) {
		background: oklch(var(--bc) / 0.1);
		font-weight: 600;
	}
	.markdown-content :global(tr:nth-child(even)) {
		background: oklch(var(--bc) / 0.05);
	}
</style>
