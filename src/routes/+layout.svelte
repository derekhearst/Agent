<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';

	let { children } = $props();

	// Restore saved theme on load
	if (browser) {
		const saved = localStorage.getItem('drokbot-theme');
		if (saved) {
			document.documentElement.setAttribute('data-theme', saved);
		}
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
