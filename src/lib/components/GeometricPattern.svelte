<script lang="ts">
	interface Props {
		variant?: 'dots' | 'grid' | 'hexagons';
		opacity?: number;
	}

	let { variant = 'hexagons', opacity = 0.03 }: Props = $props();
</script>

<div
	class="geometric-pattern pointer-events-none absolute inset-0 overflow-hidden"
	style="opacity: {opacity}"
>
	{#if variant === 'dots'}
		<svg class="h-full w-full" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
					<circle cx="2" cy="2" r="1" fill="currentColor" />
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill="url(#dots)" />
		</svg>
	{:else if variant === 'grid'}
		<svg class="h-full w-full" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<pattern id="grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
					<path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" stroke-width="0.5" />
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill="url(#grid)" />
		</svg>
	{:else if variant === 'hexagons'}
		<svg class="h-full w-full" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<pattern
					id="hexagons"
					x="0"
					y="0"
					width="56"
					height="100"
					patternUnits="userSpaceOnUse"
					patternTransform="scale(0.5)"
				>
					<path
						d="M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100"
						fill="none"
						stroke="currentColor"
						stroke-width="1"
					/>
					<path
						d="M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34"
						fill="none"
						stroke="currentColor"
						stroke-width="1"
					/>
				</pattern>
				<linearGradient id="hex-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:0.5" />
					<stop offset="25%" style="stop-color:#feca57;stop-opacity:0.5" />
					<stop offset="50%" style="stop-color:#48dbfb;stop-opacity:0.5" />
					<stop offset="75%" style="stop-color:#ff9ff3;stop-opacity:0.5" />
					<stop offset="100%" style="stop-color:#54a0ff;stop-opacity:0.5" />
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#hexagons)" stroke="url(#hex-gradient)" />
		</svg>
	{/if}
</div>

<style>
	.geometric-pattern {
		z-index: 0;
	}

	.geometric-pattern svg {
		color: currentColor;
	}
</style>
