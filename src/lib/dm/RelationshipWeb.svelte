<script lang="ts">
	import { onMount } from 'svelte';

	interface Npc {
		id: string;
		name: string;
		factionId?: string | null;
		stance: string;
		alive: boolean;
		location?: string | null;
	}

	interface Faction {
		id: string;
		name: string;
		reputation: number;
	}

	interface Props {
		npcs: Npc[];
		factions: Faction[];
	}

	let { npcs, factions }: Props = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let width = $state(800);
	let height = $state(500);

	// Node positions (stable layout using force-directed approximation)
	interface Node {
		id: string;
		label: string;
		type: 'npc' | 'faction';
		x: number;
		y: number;
		vx: number;
		vy: number;
		color: string;
		radius: number;
		alive?: boolean;
	}

	interface Edge {
		from: string;
		to: string;
		label?: string;
	}

	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let hoveredNode = $state<Node | null>(null);
	let draggingNode = $state<Node | null>(null);
	let containerEl: HTMLDivElement | undefined = $state();

	const factionColors = [
		'#FF6B6B',
		'#4ECDC4',
		'#45B7D1',
		'#96CEB4',
		'#FFEAA7',
		'#DDA0DD',
		'#98D8C8',
		'#F7DC6F'
	];

	function buildGraph() {
		const newNodes: Node[] = [];
		const newEdges: Edge[] = [];
		const cx = width / 2;
		const cy = height / 2;

		// Add faction nodes in a circle
		factions.forEach((f, i) => {
			const angle = (2 * Math.PI * i) / Math.max(factions.length, 1);
			const r = Math.min(width, height) * 0.3;
			newNodes.push({
				id: `faction-${f.id}`,
				label: f.name,
				type: 'faction',
				x: cx + r * Math.cos(angle),
				y: cy + r * Math.sin(angle),
				vx: 0,
				vy: 0,
				color: factionColors[i % factionColors.length],
				radius: 28
			});
		});

		// Add NPC nodes
		npcs.forEach((npc) => {
			const faction = factions.find((f) => f.id === npc.factionId);
			const factionNode = faction ? newNodes.find((n) => n.id === `faction-${faction.id}`) : null;

			// Position near faction if assigned, otherwise random
			let x: number, y: number;
			if (factionNode) {
				const angle = Math.random() * 2 * Math.PI;
				const dist = 60 + Math.random() * 40;
				x = factionNode.x + dist * Math.cos(angle);
				y = factionNode.y + dist * Math.sin(angle);
			} else {
				x = 40 + Math.random() * (width - 80);
				y = 40 + Math.random() * (height - 80);
			}

			newNodes.push({
				id: `npc-${npc.id}`,
				label: npc.name,
				type: 'npc',
				x,
				y,
				vx: 0,
				vy: 0,
				color: factionNode?.color || '#888',
				radius: npc.alive ? 16 : 12,
				alive: npc.alive
			});

			// Edge from NPC to faction
			if (faction) {
				newEdges.push({
					from: `npc-${npc.id}`,
					to: `faction-${faction.id}`,
					label: npc.stance !== 'Neutral' ? npc.stance : undefined
				});
			}
		});

		// Simple force-directed relaxation (a few iterations)
		for (let iter = 0; iter < 50; iter++) {
			for (const n of newNodes) {
				n.vx = 0;
				n.vy = 0;
			}
			// Repulsion between all node pairs
			for (let i = 0; i < newNodes.length; i++) {
				for (let j = i + 1; j < newNodes.length; j++) {
					const a = newNodes[i],
						b = newNodes[j];
					let dx = a.x - b.x,
						dy = a.y - b.y;
					const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
					const force = 300 / (dist * dist);
					dx = (dx / dist) * force;
					dy = (dy / dist) * force;
					a.vx += dx;
					a.vy += dy;
					b.vx -= dx;
					b.vy -= dy;
				}
			}
			// Attraction along edges
			for (const e of newEdges) {
				const a = newNodes.find((n) => n.id === e.from);
				const b = newNodes.find((n) => n.id === e.to);
				if (!a || !b) continue;
				let dx = b.x - a.x,
					dy = b.y - a.y;
				const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
				const force = (dist - 80) * 0.01;
				dx = (dx / dist) * force;
				dy = (dy / dist) * force;
				a.vx += dx;
				a.vy += dy;
				b.vx -= dx;
				b.vy -= dy;
			}
			// Center gravity
			for (const n of newNodes) {
				n.vx += (cx - n.x) * 0.001;
				n.vy += (cy - n.y) * 0.001;
			}
			// Apply
			for (const n of newNodes) {
				n.x = Math.max(n.radius, Math.min(width - n.radius, n.x + n.vx));
				n.y = Math.max(n.radius, Math.min(height - n.radius, n.y + n.vy));
			}
		}

		nodes = newNodes;
		edges = newEdges;
	}

	function draw() {
		if (!canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		// Draw edges
		ctx.lineWidth = 1.5;
		for (const e of edges) {
			const from = nodes.find((n) => n.id === e.from);
			const to = nodes.find((n) => n.id === e.to);
			if (!from || !to) continue;

			ctx.strokeStyle = 'rgba(128,128,128,0.3)';
			ctx.beginPath();
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(to.x, to.y);
			ctx.stroke();

			if (e.label) {
				const mx = (from.x + to.x) / 2;
				const my = (from.y + to.y) / 2;
				ctx.fillStyle = 'rgba(150,150,150,0.7)';
				ctx.font = '9px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText(e.label, mx, my - 4);
			}
		}

		// Draw nodes
		for (const n of nodes) {
			ctx.beginPath();
			ctx.arc(n.x, n.y, n.radius, 0, 2 * Math.PI);

			if (n.type === 'faction') {
				ctx.fillStyle = n.color;
				ctx.fill();
				ctx.strokeStyle = 'rgba(255,255,255,0.6)';
				ctx.lineWidth = 2;
				ctx.stroke();
			} else {
				ctx.fillStyle = n.alive !== false ? n.color : '#555';
				ctx.globalAlpha = n.alive !== false ? 0.8 : 0.4;
				ctx.fill();
				ctx.globalAlpha = 1;
				if (hoveredNode?.id === n.id) {
					ctx.strokeStyle = '#fff';
					ctx.lineWidth = 2;
					ctx.stroke();
				}
			}

			// Labels
			ctx.fillStyle = '#ddd';
			ctx.font = n.type === 'faction' ? 'bold 11px sans-serif' : '10px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			if (n.type === 'faction') {
				ctx.fillStyle = '#000';
				ctx.fillText(n.label, n.x, n.y);
			} else {
				ctx.fillText(n.label, n.x, n.y + n.radius + 10);
				if (n.alive === false) {
					ctx.fillStyle = '#ff6b6b';
					ctx.font = '8px sans-serif';
					ctx.fillText('☠', n.x, n.y);
				}
			}
		}

		// Tooltip for hovered node
		if (hoveredNode) {
			const npc = npcs.find((n) => `npc-${n.id}` === hoveredNode!.id);
			if (npc) {
				const faction = factions.find((f) => f.id === npc.factionId);
				const lines = [npc.name];
				if (faction) lines.push(`Faction: ${faction.name}`);
				if (npc.stance) lines.push(`Stance: ${npc.stance}`);
				if (npc.location) lines.push(`Location: ${npc.location}`);
				if (!npc.alive) lines.push('DECEASED');

				const tx = Math.min(hoveredNode.x + 20, width - 150);
				const ty = Math.max(hoveredNode.y - 20, 40);

				ctx.fillStyle = 'rgba(0,0,0,0.85)';
				const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
				ctx.fillRect(tx, ty, maxW, lines.length * 16 + 8);
				ctx.fillStyle = '#fff';
				ctx.font = '11px sans-serif';
				ctx.textAlign = 'left';
				lines.forEach((line, i) => {
					ctx.fillText(line, tx + 8, ty + 16 + i * 16);
				});
			}
		}
	}

	function handleMouseMove(e: MouseEvent) {
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		if (draggingNode) {
			draggingNode.x = Math.max(draggingNode.radius, Math.min(width - draggingNode.radius, mx));
			draggingNode.y = Math.max(draggingNode.radius, Math.min(height - draggingNode.radius, my));
			draw();
			return;
		}

		const hit = nodes.find((n) => {
			const dx = mx - n.x,
				dy = my - n.y;
			return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
		});
		hoveredNode = hit || null;
		if (canvasEl) canvasEl.style.cursor = hit ? 'grab' : 'default';
		draw();
	}

	function handleMouseDown(e: MouseEvent) {
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const hit = nodes.find((n) => {
			const dx = mx - n.x,
				dy = my - n.y;
			return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
		});
		if (hit) {
			draggingNode = hit;
			if (canvasEl) canvasEl.style.cursor = 'grabbing';
		}
	}

	function handleMouseUp() {
		draggingNode = null;
		if (canvasEl) canvasEl.style.cursor = hoveredNode ? 'grab' : 'default';
	}

	function handleResize() {
		if (containerEl) {
			width = containerEl.clientWidth;
			height = Math.max(400, Math.min(600, window.innerHeight * 0.5));
			buildGraph();
			draw();
		}
	}

	$effect(() => {
		// React to data changes — trigger when npcs or factions list changes
		if (npcs.length > 0 || factions.length > 0) {
			if (canvasEl) {
				buildGraph();
				draw();
			}
		}
	});

	onMount(() => {
		handleResize();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

<div class="rounded-box border border-base-300 bg-base-200 p-4" bind:this={containerEl}>
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-sm font-semibold">🕸️ Relationship Web</h3>
		<div class="flex items-center gap-2">
			<span class="text-xs opacity-40">Drag nodes to rearrange</span>
			<button
				class="btn btn-ghost btn-xs"
				onclick={() => {
					buildGraph();
					draw();
				}}>Reset Layout</button
			>
		</div>
	</div>

	{#if npcs.length === 0 && factions.length === 0}
		<p class="py-8 text-center text-sm opacity-50">
			Add NPCs and Factions to see the relationship web.
		</p>
	{:else}
		<canvas
			bind:this={canvasEl}
			{width}
			{height}
			class="w-full rounded-lg"
			onmousemove={handleMouseMove}
			onmousedown={handleMouseDown}
			onmouseup={handleMouseUp}
			onmouseleave={handleMouseUp}
		></canvas>

		<!-- Legend -->
		<div class="mt-2 flex flex-wrap gap-3">
			{#each factions as f, i (f.id)}
				<div class="flex items-center gap-1">
					<div
						class="h-3 w-3 rounded-full"
						style="background: {factionColors[i % factionColors.length]}"
					></div>
					<span class="text-xs">{f.name} ({f.reputation >= 0 ? '+' : ''}{f.reputation})</span>
				</div>
			{/each}
			<div class="flex items-center gap-1">
				<div class="h-3 w-3 rounded-full bg-gray-500"></div>
				<span class="text-xs">Unaffiliated</span>
			</div>
		</div>
	{/if}
</div>
