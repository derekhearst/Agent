<script lang="ts">
	let activeGenerator = $state<'name' | 'tavern' | 'encounter' | 'loot' | 'rumor'>('name');
	let result = $state('');
	let history = $state<string[]>([]);

	// ===== NAME GENERATOR =====
	const firstNames = [
		'Aldric',
		'Brenna',
		'Calder',
		'Dahlia',
		'Elric',
		'Fiona',
		'Gareth',
		'Helena',
		'Idris',
		'Jolene',
		'Kael',
		'Lyra',
		'Magnus',
		'Nera',
		'Orin',
		'Petra',
		'Quinn',
		'Rhiannon',
		'Soren',
		'Thalia',
		'Ulric',
		'Vala',
		'Wren',
		'Xander',
		'Ylva',
		'Zephyr',
		'Ash',
		'Bramble',
		'Crow',
		'Dusk',
		'Ember',
		'Frost',
		'Grim',
		'Hollow',
		'Iron',
		'Jade',
		'Kestrel',
		'Lark',
		'Moss',
		'Nettle',
		'Oak',
		'Pike',
		'Quill',
		'Rook',
		'Sage',
		'Thorn',
		'Umber',
		'Vale',
		'Wisp',
		'Yarrow'
	];
	const lastNames = [
		'Blackwood',
		'Ironforge',
		'Thornwall',
		'Greystone',
		'Brightblade',
		'Shadowmere',
		'Stormwind',
		'Duskwalker',
		'Fireheart',
		'Frostbeard',
		'Goldenleaf',
		'Hawkeye',
		'Ironjaw',
		'Moonwhisper',
		'Nightshade',
		'Oakshield',
		'Ravencrest',
		'Silverhand',
		'Wolfsbane',
		'Ashenborn',
		'Bonegrinder',
		'Copperfield',
		'Deepbrook',
		'Embervein',
		'Flintlock',
		'Grimshaw',
		'Hillcrest',
		'Kettleblack',
		'Longstrider',
		'Marshwell'
	];
	const epithets = [
		'the Bold',
		'the Wise',
		'Oathbreaker',
		'the Silent',
		'the Scarred',
		'Firebrand',
		'Worldwalker',
		'the Mad',
		'Twice-Born',
		'the Unyielding',
		'Bloodraven',
		'the Merchant',
		'Ghosthand',
		'the Exile',
		'Truthseeker'
	];
	const races = [
		'Human',
		'Elf',
		'Dwarf',
		'Halfling',
		'Gnome',
		'Half-Orc',
		'Tiefling',
		'Dragonborn'
	];

	function pick<T>(arr: T[]): T {
		return arr[Math.floor(Math.random() * arr.length)];
	}

	function generateName() {
		const hasEpithet = Math.random() > 0.6;
		const name = `${pick(firstNames)} ${pick(lastNames)}${hasEpithet ? `, ${pick(epithets)}` : ''}`;
		const race = pick(races);
		result = `**${name}** — ${race}`;
		history = [result, ...history.slice(0, 19)];
	}

	// ===== TAVERN GENERATOR =====
	const tavernAdj = [
		'Rusty',
		'Golden',
		'Prancing',
		'Sleeping',
		'Broken',
		'Lucky',
		'Drunken',
		'Silver',
		'Crimson',
		'Wandering',
		'Dancing',
		'Howling',
		'Blind',
		'Singing',
		'Weeping',
		'Jolly',
		'Grim',
		'Emerald',
		'Flaming',
		'Twilight'
	];
	const tavernNoun = [
		'Dragon',
		'Unicorn',
		'Goblin',
		'Stag',
		'Barrel',
		'Tankard',
		'Raven',
		'Serpent',
		'Griffin',
		'Anchor',
		'Sword',
		'Crown',
		'Hound',
		'Mare',
		'Oak',
		'Lion',
		'Fox',
		'Hawk',
		'Bear',
		'Wyvern'
	];
	const tavernType = ['Inn', 'Tavern', 'Pub', 'Alehouse', 'Lodge', 'Rest', 'Haven', 'Hall'];
	const tavernQuirks = [
		'The bartender is a retired adventurer with a hook for a hand.',
		'A bard in the corner plays the same song on repeat — badly.',
		'The house special comes with a side of dubious mushrooms.',
		'A notice board near the door is covered in quest postings.',
		'A one-eyed cat sits on the bar and judges everyone.',
		'The fireplace conceals a secret passage.',
		'All the furniture is slightly too small — built for halflings.',
		'A pickled dragon egg sits in a jar behind the bar.',
		'The ale is surprisingly good. Suspiciously good.',
		"There's a fighting pit in the basement, and tonight is match night.",
		'The innkeeper speaks only in rhyming couplets.',
		'A permanent illusion makes the ceiling look like a night sky.',
		"There are secret symbols carved into the tables — thieves' cant.",
		'A loud parrot repeats overheard conversations from behind the bar.',
		'The menu changes daily based on what the cook hunted that morning.'
	];

	function generateTavern() {
		const name = `The ${pick(tavernAdj)} ${pick(tavernNoun)} ${pick(tavernType)}`;
		const quirk = pick(tavernQuirks);
		result = `**${name}**\n${quirk}`;
		history = [result, ...history.slice(0, 19)];
	}

	// ===== ENCOUNTER GENERATOR =====
	const encounterTypes = ['combat', 'social', 'environmental', 'mystery'] as const;
	const encounters: Record<string, string[]> = {
		combat: [
			'A band of goblins has set up a toll on the road.',
			'A wounded owlbear crashes through the underbrush, enraged.',
			'Bandits disguised as travelling merchants approach.',
			'An animated suit of armor guards a bridge and challenges travelers.',
			'A pack of wolves, led by a dire wolf, stalks the party.',
			'Skeletal warriors rise from a roadside graveyard at dusk.',
			'A troll demands a riddle contest — fights if you lose.',
			'A rival adventuring party mistakes you for wanted criminals.'
		],
		social: [
			'A lost child claims their village has been taken over by fey.',
			'A travelling merchant offers a deal that seems too good to be true.',
			"A noble's carriage is broken down; they demand help imperiously.",
			'A group of pilgrims asks to travel together for safety.',
			"A disguised dragon in humanoid form tests the party's morals.",
			'Two feuding farmers demand the party arbitrate their dispute.',
			"A fortune teller offers a free reading that's unsettlingly accurate.",
			'A bard challenges a party member to a performance contest.'
		],
		environmental: [
			'A sudden storm forces the party to seek shelter in a cave.',
			'The bridge is out — the river is deep and fast.',
			'Quicksand patches dot the trail through the swamp.',
			'A landslide blocks the mountain pass.',
			'Thick fog rolls in; navigation becomes nearly impossible.',
			'A wildfire approaches from the west, cutting off the road.',
			'An earthquake opens a fissure revealing ancient ruins below.',
			'Extreme cold sets in; hypothermia becomes a real threat.'
		],
		mystery: [
			'A scarecrow in a field turns its head as the party passes.',
			'A abandoned camp with still-warm food but no people.',
			'Strange symbols carved into every tree in a one-mile radius.',
			'A mirror in a ruined tower shows each viewer a different age.',
			'A door stands alone in an open field — locked.',
			"Travelers on the road don't remember where they're going.",
			'A clockwork bird delivers a message meant for someone else.',
			'A village celebrates a festival no one can explain.'
		]
	};

	function generateEncounter() {
		const type = pick([...encounterTypes]);
		const enc = pick(encounters[type]);
		result = `**${type.charAt(0).toUpperCase() + type.slice(1)} Encounter**\n${enc}`;
		history = [result, ...history.slice(0, 19)];
	}

	// ===== LOOT GENERATOR =====
	const mundaneLoot = [
		'a silver locket with a faded portrait',
		'a half-eaten wheel of cheese',
		'a map to an unknown location',
		'a set of loaded dice',
		'a love letter never sent',
		'a jar of phosphorescent fireflies',
		'3d6 gold pieces',
		'a dagger with a name engraved on it',
		'a compass that always points east',
		'boots that are always warm',
		'a small music box that plays a lullaby',
		'a sealed letter addressed to "The Keeper"',
		'a vial of ink that changes color',
		'a coin that always lands on heads',
		'a pair of spectacles that make text glow'
	];
	const magicLoot = [
		'**Cloak of Whispered Warnings** — Advantage on initiative rolls',
		'**Ring of Minor Telekinesis** — Move objects < 5lbs within 30ft',
		'**Boots of Spider Climbing** — Walk on walls and ceilings',
		'**Dagger of Returning** — Returns to hand after thrown',
		'**Amulet of Tongues** — Understand (not speak) all languages',
		'**Bag of Caltrops** — Refills itself every dawn (20 caltrops)',
		'**Everburning Lantern** — Never needs oil, can be dimmed',
		'**Quiver of Plenty** — Produces 1d6 mundane arrows per dawn',
		'**Helm of Aquatic Action** — Breathe underwater for 1 hour/day',
		'**Gloves of Thievery** — +5 to Sleight of Hand checks'
	];

	function generateLoot() {
		const isMagic = Math.random() > 0.65;
		result = isMagic ? pick(magicLoot) : pick(mundaneLoot);
		history = [result, ...history.slice(0, 19)];
	}

	// ===== RUMOR GENERATOR =====
	const rumors = [
		'They say the old mine is haunted, but the miners swear they hear singing.',
		"The mayor's been meeting someone at midnight. In the graveyard.",
		"A dragon's been spotted in the mountains — or maybe just a very big bird.",
		'The well in the town square has started producing water that glows blue.',
		"Someone's been stealing chickens. All of them. From every farm.",
		"The blacksmith forged a weapon last week and hasn't slept since.",
		'A ship washed ashore with no crew. The cargo hold was full of dolls.',
		"The old wizard's tower lit up last night — but he died years ago.",
		"Fey have been spotted at the edge of the forest. They're... planting trees?",
		"The king's advisor has been replaced. No one noticed for weeks.",
		'Every dog in town howled at the same time last Thursday.',
		"A merchant is selling potions that actually work. That's the suspicious part.",
		"A bounty poster appeared overnight — it's for someone who hasn't been born yet.",
		'The statue in the square moved. Just an inch. But it definitely moved.',
		'A bard went into the dungeon. Came out three minutes later, hair turned white.',
		"There's a new tavern in town. No one can remember when it was built.",
		'The ferryman says the river has been whispering a name.',
		"Someone found a door in the cellar. There wasn't a cellar before.",
		'The harvest festival has been cancelled. The crops "aren\'t ready to be picked."',
		'A child in town can see invisible creatures. The parents are terrified.'
	];

	function generateRumor() {
		result = `*"${pick(rumors)}"*`;
		history = [result, ...history.slice(0, 19)];
	}

	function generate() {
		switch (activeGenerator) {
			case 'name':
				generateName();
				break;
			case 'tavern':
				generateTavern();
				break;
			case 'encounter':
				generateEncounter();
				break;
			case 'loot':
				generateLoot();
				break;
			case 'rumor':
				generateRumor();
				break;
		}
	}
</script>

<div class="rounded-box border border-base-300 bg-base-200 p-4">
	<h3 class="mb-3 text-sm font-semibold">🎲 Random Generators</h3>

	<!-- Generator type tabs -->
	<div class="tabs-boxed mb-3 tabs">
		{#each [{ key: 'name', label: '👤 NPC' }, { key: 'tavern', label: '🍺 Tavern' }, { key: 'encounter', label: '⚔️ Encounter' }, { key: 'loot', label: '💰 Loot' }, { key: 'rumor', label: '💬 Rumor' }] as tab (tab.key)}
			<button
				class="tab-sm tab"
				class:tab-active={activeGenerator === tab.key}
				onclick={() => {
					activeGenerator = tab.key as typeof activeGenerator;
				}}>{tab.label}</button
			>
		{/each}
	</div>

	<!-- Generate button -->
	<button class="btn w-full btn-sm btn-accent" onclick={generate}>
		🎲 Generate {activeGenerator === 'name'
			? 'NPC Name'
			: activeGenerator === 'tavern'
				? 'Tavern'
				: activeGenerator === 'encounter'
					? 'Encounter'
					: activeGenerator === 'loot'
						? 'Loot'
						: 'Rumor'}
	</button>

	<!-- Current result -->
	{#if result}
		<div class="mt-3 rounded-lg border border-accent/20 bg-base-100 p-3">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html result
				.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
				.replace(/\*(.*?)\*/g, '<em>$1</em>')
				.replace(/\n/g, '<br>')}
		</div>
	{/if}

	<!-- History -->
	{#if history.length > 1}
		<details class="mt-3">
			<summary class="cursor-pointer text-xs opacity-50">History ({history.length})</summary>
			<div class="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
				{#each history.slice(1) as h (h)}
					<div class="rounded border border-base-300 p-1.5 text-xs">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html h
							.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
							.replace(/\*(.*?)\*/g, '<em>$1</em>')
							.replace(/\n/g, '<br>')}
					</div>
				{/each}
			</div>
		</details>
	{/if}
</div>
