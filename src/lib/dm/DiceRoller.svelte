<script lang="ts">
	let expression = $state('');
	let results = $state<Array<{ expr: string; rolls: number[]; total: number }>>([]);
	let error = $state('');

	const presets = [
		{ label: 'd20', expr: '1d20' },
		{ label: '2d6', expr: '2d6' },
		{ label: 'd100', expr: '1d100' },
		{ label: '4d6 drop', expr: '4d6kh3' },
		{ label: 'd8', expr: '1d8' },
		{ label: 'd12', expr: '1d12' }
	];

	function rollDice(expr: string) {
		error = '';
		try {
			const result = parseAndRoll(expr.trim().toLowerCase());
			results = [result, ...results.slice(0, 19)];
			expression = '';
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function parseAndRoll(expr: string): { expr: string; rolls: number[]; total: number } {
		// Support: NdS, NdSkh/klM, NdS+C, NdS-C, combinations with +
		const parts = expr.split(/(?=[+-])/);
		let allRolls: number[] = [];
		let total = 0;
		let displayExpr = expr;

		for (const part of parts) {
			const trimmed = part.replace(/^\+/, '').trim();
			const diceMatch = trimmed.match(/^(-?)(\d+)d(\d+)(?:(kh|kl)(\d+))?$/);
			if (diceMatch) {
				const neg = diceMatch[1] === '-';
				const count = parseInt(diceMatch[2]);
				const sides = parseInt(diceMatch[3]);
				const keepMode = diceMatch[4] as 'kh' | 'kl' | undefined;
				const keepCount = diceMatch[5] ? parseInt(diceMatch[5]) : count;

				if (count > 100 || sides > 1000) throw new Error('Too many dice or sides');

				let rolls: number[] = [];
				for (let i = 0; i < count; i++) {
					rolls.push(Math.floor(Math.random() * sides) + 1);
				}

				if (keepMode === 'kh') {
					rolls.sort((a, b) => b - a);
					rolls = rolls.slice(0, keepCount);
				} else if (keepMode === 'kl') {
					rolls.sort((a, b) => a - b);
					rolls = rolls.slice(0, keepCount);
				}

				const subtotal = rolls.reduce((a, b) => a + b, 0);
				total += neg ? -subtotal : subtotal;
				allRolls.push(...rolls);
			} else {
				// Constant modifier
				const num = parseInt(trimmed);
				if (isNaN(num)) throw new Error(`Invalid: "${trimmed}"`);
				total += num;
			}
		}

		return { expr: displayExpr, rolls: allRolls, total };
	}
</script>

<div class="rounded-box border border-base-300 bg-base-200 p-3">
	<h3 class="mb-2 text-xs font-semibold opacity-60">🎲 Dice Roller</h3>

	<!-- Preset buttons -->
	<div class="mb-2 flex flex-wrap gap-1">
		{#each presets as p (p.label)}
			<button class="btn btn-ghost btn-xs" onclick={() => rollDice(p.expr)}>
				{p.label}
			</button>
		{/each}
	</div>

	<!-- Custom input -->
	<form
		class="flex gap-1"
		onsubmit={(e) => {
			e.preventDefault();
			if (expression.trim()) rollDice(expression);
		}}
	>
		<input
			type="text"
			class="input-bordered input input-xs flex-1"
			placeholder="2d6+3, 4d6kh3..."
			bind:value={expression}
		/>
		<button type="submit" class="btn btn-xs btn-primary" disabled={!expression.trim()}>Roll</button>
	</form>

	{#if error}
		<div class="mt-1 text-xs text-error">{error}</div>
	{/if}

	<!-- Results -->
	{#if results.length > 0}
		<div class="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
			{#each results as r, i (i)}
				<div class="flex items-center gap-2 text-xs" class:opacity-40={i > 0}>
					<span class="font-mono opacity-50">{r.expr}</span>
					<span class="opacity-40">[{r.rolls.join(', ')}]</span>
					<span class="font-bold text-primary">= {r.total}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
