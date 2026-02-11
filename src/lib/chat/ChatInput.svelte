<script lang="ts">
	interface Props {
		disabled?: boolean;
		onSend: (message: string) => void;
	}

	let { disabled = false, onSend }: Props = $props();
	let input = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	function handleSubmit() {
		const trimmed = input.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		input = '';
		// Reset height
		if (textarea) textarea.style.height = 'auto';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function autoResize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
	}

	export function setValue(value: string) {
		input = value;
		// Focus and resize after setting value
		requestAnimationFrame(() => {
			if (textarea) {
				textarea.focus();
				autoResize();
			}
		});
	}
</script>

<form
	class="relative flex items-end gap-2 border-t border-base-300 bg-base-100 p-4"
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
>
	<!-- Rainbow gradient border wrapper -->
	<div class="rainbow-border relative flex-1">
		<textarea
			bind:this={textarea}
			bind:value={input}
			onkeydown={handleKeydown}
			oninput={autoResize}
			{disabled}
			placeholder="Message DrokBot..."
			rows="1"
			class="w-full resize-none rounded-lg border-0 bg-base-200 px-4 py-3 text-sm leading-relaxed outline-none focus:ring-0"
		></textarea>
	</div>
	<button
		type="submit"
		class="btn btn-sm btn-primary"
		disabled={disabled || !input.trim()}
		title="Send message"
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<path
				d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z"
			/>
		</svg>
	</button>
</form>

<style>
	.rainbow-border {
		--rainbow-gradient: linear-gradient(
			90deg,
			#ff6b6b,
			#feca57,
			#48dbfb,
			#ff9ff3,
			#54a0ff,
			#5f27cd,
			#ff6b6b
		);
		background: var(--rainbow-gradient);
		background-size: 200% 100%;
		animation: rainbow-shift 4s linear infinite;
		padding: 2px;
		border-radius: 0.625rem;
	}

	.rainbow-border textarea {
		border-radius: 0.5rem;
	}

	.rainbow-border:focus-within {
		animation: rainbow-shift 2s linear infinite;
		box-shadow: 0 0 20px rgba(84, 160, 255, 0.3);
	}

	@keyframes rainbow-shift {
		0% {
			background-position: 0% 50%;
		}
		100% {
			background-position: 200% 50%;
		}
	}
</style>
