<script lang="ts">
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;

		try {
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});

			if (res.ok) {
				window.location.href = '/';
			} else {
				error = 'Incorrect password';
				password = '';
			}
		} catch {
			error = 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-base-200">
	<div class="card w-96 bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title justify-center text-2xl">🔒 Agent</h2>
			<p class="text-center text-sm text-base-content/60">Enter password to continue</p>

			<form onsubmit={handleSubmit} class="mt-4 flex flex-col gap-4">
				<input
					type="password"
					class="input-bordered input w-full"
					placeholder="Password"
					bind:value={password}
					autofocus
					required
				/>

				{#if error}
					<p class="text-sm text-error">{error}</p>
				{/if}

				<button type="submit" class="btn w-full btn-primary" disabled={submitting}>
					{submitting ? 'Checking...' : 'Log In'}
				</button>
			</form>
		</div>
	</div>
</div>
