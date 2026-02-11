<script lang="ts">
	interface Props {
		currentRoute?: string;
	}

	let { currentRoute = '/' }: Props = $props();

	const themes = [
		'dark',
		'light',
		'cupcake',
		'synthwave',
		'cyberpunk',
		'dracula',
		'night',
		'coffee',
		'dim',
		'nord',
		'sunset',
		'abyss',
		'forest',
		'luxury',
		'black',
		'business',
		'halloween'
	];

	let settingsOpen = $state(false);

	function setTheme(theme: string) {
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('drokbot-theme', theme);
	}

	const menuItems = [
		{
			label: 'Chat',
			href: '/',
			icon: 'chat',
			active: true
		},
		{
			label: 'Images',
			href: '#',
			icon: 'image',
			active: false,
			disabled: true
		},
		{
			label: 'Files',
			href: '#',
			icon: 'folder',
			active: false,
			disabled: true
		},
		{
			label: 'Memory',
			href: '/memory',
			icon: 'brain',
			active: false
		}
	];
</script>

{#snippet menuIcon(icon: string)}
	{#if icon === 'chat'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<path
				fill-rule="evenodd"
				d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 001.33 0l1.713-3.293a.783.783 0 01.642-.413 41.102 41.102 0 003.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0010 2zM6.75 6a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 2.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"
				clip-rule="evenodd"
			/>
		</svg>
	{:else if icon === 'image'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<path
				fill-rule="evenodd"
				d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909a.75.75 0 01-1.06 0L6.97 7.53a.75.75 0 00-1.06 0l-3.41 3.53z"
				clip-rule="evenodd"
			/>
		</svg>
	{:else if icon === 'folder'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<path
				d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75z"
			/>
			<path
				d="M3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z"
			/>
		</svg>
	{:else if icon === 'brain'}
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
			<path
				d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06a.75.75 0 11-1.06 1.06L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 01-1.061-1.06l1.06-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 2.25a.75.75 0 010 1.5H2.25a.75.75 0 010-1.5h1.5zm14.5 0a.75.75 0 010 1.5h-1.5a.75.75 0 010-1.5h1.5zM5.05 15.95a.75.75 0 011.06-1.06l1.062 1.06a.75.75 0 01-1.06 1.06l-1.062-1.06zm9.9 0a.75.75 0 01-1.06 0l-1.06-1.06a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM10 17a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 17z"
			/>
		</svg>
	{/if}
{/snippet}

<div class="flex h-full flex-col border-r border-base-300">
	<div class="flex items-center justify-between border-b border-base-300 p-4">
		<h1 class="text-lg font-bold">DrokBot</h1>
		<details class="dropdown dropdown-end" bind:open={settingsOpen}>
			<summary class="btn btn-square btn-ghost btn-sm">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-5 w-5"
				>
					<path
						fill-rule="evenodd"
						d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
						clip-rule="evenodd"
					/>
				</svg>
			</summary>
			<div class="dropdown-content z-50 mt-2 w-52 rounded-box bg-base-200 p-3 shadow-lg">
				<h3 class="mb-2 text-xs font-semibold uppercase opacity-50">Theme</h3>
				<div class="flex max-h-60 flex-col gap-1 overflow-y-auto">
					{#each themes as theme (theme)}
						<button
							class="btn justify-start capitalize btn-ghost btn-sm"
							onclick={() => {
								setTheme(theme);
								settingsOpen = false;
							}}
						>
							<span data-theme={theme} class="flex gap-1 rounded-sm px-1">
								<span class="h-3 w-1.5 rounded-sm bg-primary"></span>
								<span class="h-3 w-1.5 rounded-sm bg-secondary"></span>
								<span class="h-3 w-1.5 rounded-sm bg-accent"></span>
								<span class="h-3 w-1.5 rounded-sm bg-neutral"></span>
							</span>
							{theme}
						</button>
					{/each}
				</div>
			</div>
		</details>
	</div>

	<ul class="menu gap-1 p-3">
		{#each menuItems as item (item.label)}
			<li>
				{#if item.disabled}
					<span class="cursor-not-allowed gap-3 opacity-40">
						{@render menuIcon(item.icon)}
						{item.label}
						<span class="badge badge-ghost badge-xs">Soon</span>
					</span>
				{:else}
					<a href={item.href} class:active={item.href === currentRoute} class="gap-3">
						{@render menuIcon(item.icon)}
						{item.label}
					</a>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="mt-auto border-t border-base-300 p-3">
		<div class="text-xs opacity-40">DrokBot v0.1</div>
	</div>
</div>
