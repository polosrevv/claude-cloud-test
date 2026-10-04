# Blockcraft

A Minecraft-style survival game that runs in the browser. It is plain JavaScript and raw WebGL2: no build step, no dependencies and no image files. Every texture, model and sound is generated in code.

You can play it start to finish. Punch trees, craft tools, mine for iron and diamonds, survive the night, build a portal to the Nether, take blaze rods from a fortress, follow eyes of ender to a stronghold, and kill the Ender Dragon.

## Run it

```sh
npm start            # serves the folder at http://localhost:8080
```

Any static file server works too, for example `python3 -m http.server 8080`. Opening `index.html` straight from disk does not work, because browsers block ES modules and Web Workers on `file://` URLs.

You need a browser with WebGL2: current Chrome, Edge, Firefox or Safari, on desktop or mobile.

## What's in it

### Game modes and worlds

- **Survival**, **Creative** and **Spectator** modes, plus Peaceful, Easy, Normal and Hard difficulty.
- **A world list.** Create, name, seed, play and delete worlds. Everything is saved in the browser: blocks, chests, furnaces, entities, your inventory, health, spawn point, advancements and all three dimensions. Saves happen automatically every 30 seconds and when you pause or quit.
- **Cheats** are a per-world option that turns on chat commands.

### Survival

- **Survival stats.** You have health, hunger and saturation, and air underwater. You take damage from falls, lava, fire, cactus, drowning, starving and the void. Armour soaks up damage. When you die, you drop your items and respawn at your bed or the world spawn.
- **Mining.** Breaking times use Minecraft's formula. The right tool is faster, and harder blocks need a better pickaxe: stone for iron, iron for gold and diamond, diamond for obsidian. Tools wear out.
- **Crafting.** There's a 2×2 grid in your inventory and a 3×3 grid at a crafting table, with 129 recipes. These include tools, armour, torches, beds, doors, stairs, fences and gates, glass panes, dyes for 16 colours of wool, buckets, bows and arrows, TNT, cake, and eyes of ender. The screens work like Minecraft's: click to pick up or place, right-click to split or place one, shift-click to move a stack, and number keys to swap with the hotbar.
- **Furnaces** smelt ores, cook food and burn fuel while you're away. **Chests** store 27 stacks.
- **Experience.** Orbs come from mobs you kill, ores you mine, animals you breed and furnaces you empty. They drift toward you and fill the XP bar, using Minecraft's level curve. You drop some of your experience when you die.
- **Enchanting.** Mine lapis lazuli deep underground and build an enchanting table from a book, diamonds and obsidian. Each of its three offers costs levels and lapis. Bookshelves around the table raise the offers up to level 30. There are 19 enchantments, and each does what it does in Minecraft:
  - Tools: Efficiency, Silk Touch, Fortune and Unbreaking.
  - Swords: Sharpness, Smite, Bane of Arthropods, Knockback, Fire Aspect and Looting.
  - Bows: Power, Punch, Flame and Infinity.
  - Armour: Protection, Fire Protection, Feather Falling, Respiration and Aqua Affinity.
  - Enchanted items shimmer, and their tooltips list what they carry.
- **Food.** You can eat bread, apples, golden apples, raw or cooked meat, melon slices, pumpkin pie and mushroom stew, and drink milk. Rotten flesh and raw chicken might make you hungry. Cake is placed as a block and eaten a slice at a time.

### Mobs

- **Animals:** pigs, cows, sheep and chickens. They wander, panic when hit and follow you when you hold their food. Feed two to breed them and grow the babies. You can shear sheep and milk cows. Hens lay eggs, which you can throw to hatch chicks. Squid swim in oceans and lakes and drop ink sacs.
- **Wolves** run in packs in forests and taiga, and the whole pack turns on you if you hit one. Tame one with bones. A tamed wolf wears a collar, follows you (teleporting to catch up), sits when you click it, fights whatever attacks you or whatever you attack, and heals or breeds on meat.
- **Monsters:**
  - Zombies, skeletons (they shoot arrows), creepers (they hiss and explode), spiders and endermen.
  - Slimes, which live underground in one chunk in ten, hop after you and split into smaller slimes when killed.
  - Zombie pigmen, which fill the Nether and leave you alone until you hit one, and then the whole group comes for you. Lightning turns pigs into pigmen.
  - Ghasts, which drift through the Nether's open caverns and fire explosive fireballs. Hit a fireball to bat it back.
  - Blazes in Nether fortresses, which fly and shoot fireballs.
  - The Ender Dragon.
- **AI.** Monsters spawn in the dark, path around obstacles with A\*, and burn in sunlight.

### World

- **The Overworld.**
  - Endless and generated from a seed.
  - Biomes: plains, forest, desert, snowy tundra, mountains, snowy peaks, beaches and oceans.
  - Underground: caves and caverns, ore veins, lava pools in the deepest caves, and dungeons with monster spawners and loot chests.
  - Strongholds with end portal rooms.
  - Villages in plains, deserts and snowy tundra. Each has a well, gravel roads, houses with doors and beds, a library, a blacksmith with a loot chest, wheat farms and lamp posts. Find the nearest one with `/locate village`.
- **Villagers and trading.** Farmers, librarians, clerics, blacksmiths and butchers buy raw materials for emeralds and sell food, books, glass, eyes of ender, and enchanted iron and diamond gear. Right-click a villager to trade. Offers run out and restock after a while, and every trade earns you experience. Emeralds are also mined as single ores under mountains.
- **Iron golems** guard each village and go after monsters, or after you if you hurt a villager. Zombies hunt villagers, who run from them.
- **Water and lava flow** and settle like Minecraft's fluids:
  - Two water sources make a third.
  - Water poured on still lava makes obsidian; on flowing lava it makes cobblestone.
  - Water carries off torches and plants.
- **Weather.** Rain, snow and thunderstorms come and go on Minecraft's schedule.
  - It snows in cold biomes and stays dry in deserts. Rain stops at the first block, so it never rains indoors.
  - Storms darken the sky enough for monsters to spawn by day. Lightning sets fires and hurts anything close.
  - Rain puts out fires and burning mobs, keeps zombies and skeletons from burning, waters farmland, and hurts endermen.
  - You can sleep through a thunderstorm.
- **Things grow.** Wheat grows on watered farmland. Pumpkin and melon stems ripen and set fruit beside them. Saplings grow into trees, grass spreads, and mushrooms creep across dark ground. Sugar cane and cactus grow taller. Leaves decay when their tree is cut down. Bone meal speeds all of this up.
- **Building blocks.**
  - Stairs in oak, cobblestone, stone brick, brick and sandstone, which you can walk up.
  - Fences, nether brick fences, glass panes and iron bars, which join up with their neighbours. Fences are too tall to jump.
  - Fence gates that open and close.
  - Wool in all 16 colours, pumpkins and jack o'lanterns, and melons.
  - Pumpkins and melons grow wild; mushrooms grow in forests and the Nether.
- **Working blocks:**
  - Doors open and close.
  - Beds set your spawn and skip the night when no monsters are close.
  - TNT can be lit, and explosions destroy terrain and hurt nearby players and mobs.
  - Sand and gravel fall. Torches and ladders need a wall.
- **The Nether.**
  - You get there by building a 4×5 obsidian frame and lighting it with flint and steel. Distances there are scaled 8 to 1, and the game builds a portal for you on the far side if there isn't one.
  - Inside: netherrack, soul sand, glowstone, lava seas and nether fortresses.
- **The End.** It has the end stone island, obsidian pillars topped with end crystals that heal the dragon, the dragon fight, the exit portal, the dragon egg and the credits.
- **Advancements.** 28 of them, from *Getting Wood* to *Free the End*. They act as a guide: the next goal is shown in the corner of the screen. Press L to see the whole tree.

### Engine

- **Lighting.** Sunlight and block light flood-fill through chunks. Faces get smooth lighting and ambient occlusion. Torches, glowstone, lava and fire glow.
- **Sky.** A 20-minute day with a square sun and moon, stars, sunsets, clouds and fog.
- **Models.** Block-model mobs with walk animations, a held item or arm, item drops spinning in the world, particles, and block cracks while you mine.
- **Sound.** Synthesized sound effects: footsteps, digging, mob voices, explosions and portals.
- **Touch controls** on phones and tablets.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk (double-tap `W` or hold `Ctrl` to sprint) |
| `Space` | Jump; double-tap to fly in Creative |
| `Shift` | Sneak (you won't walk off ledges), or fly down |
| Left click | Attack, or hold to mine |
| Right click | Use: place a block, eat, open a door or chest, draw a bow, pour a bucket, sleep |
| Middle click | Pick the targeted block |
| `1` to `9`, mouse wheel | Select a hotbar slot |
| `E` | Inventory (in Creative, the item catalogue) |
| `Q` | Drop one item (`Ctrl+Q` drops the stack) |
| `T` or `/` | Chat and commands |
| `L` | Advancements |
| `F3` | Debug info |
| `F1` | Hide the HUD |
| `Esc` | Pause menu (settings, difficulty, save and quit) |

If the page can't capture the mouse (some embedded frames refuse pointer lock), the game switches to drag-to-look.

## Commands

Commands work in worlds created with cheats on. Coordinates accept `~` for "relative to me", and `Tab` completes names.

| Command | What it does |
| --- | --- |
| `/gamemode <survival\|creative\|spectator>` | Change your game mode |
| `/difficulty <peaceful\|easy\|normal\|hard>` | Change the difficulty |
| `/time set <day\|night\|noon\|midnight\|ticks>`, `/time add <ticks>` | Change the time |
| `/weather <clear\|rain\|thunder> [seconds]` | Change the weather |
| `/tp <x> <y> <z>` | Teleport |
| `/give <item> [count]` | Give yourself items |
| `/summon <mob> [x y z]` | Spawn a mob |
| `/xp <amount>[L]`, `/xp add\|set <amount> [levels\|points]` | Give yourself experience |
| `/enchant <enchantment> [level]` | Enchant the item in your hand |
| `/kill [@e\|@e[type=<mob>]]` | Kill yourself, or all mobs |
| `/setblock`, `/fill` | Place one block, or fill a box |
| `/clear`, `/heal`, `/spawnpoint` | Inventory, health and spawn helpers |
| `/gamerule <rule> [true\|false]` | Change `keepInventory`, `doDaylightCycle`, `doWeatherCycle`, `doMobSpawning`, `mobGriefing`, `doFireTick` or `naturalRegeneration` |
| `/locate <stronghold\|fortress\|village>` | Find the nearest structure |
| `/seed`, `/say`, `/help` | Show the seed, say something, list the commands |

## How it works

```
index.html            page, HUD, menus and game screens (HTML + CSS)
src/main.js           app shell: title screen, world list, settings, input routing, saving
src/game.js           one play session: the 20 TPS tick, the player, interaction, damage, dimensions
src/ui.js             HUD, chat, inventory/crafting/furnace/chest screens, death and credits
src/blocks.js         block registry (219 block states), lookup tables and connecting shapes
src/items.js          item registry: blocks, tools, armour, food, materials
src/recipes.js        crafting and smelting recipes
src/inventory.js      inventories, slot clicking, crafting grids, furnaces, loot
src/drops.js          breaking times, harvest rules, block drops and ore experience
src/enchantments.js   enchantments, the enchanting table's offers and the experience curve
src/terrain.js        Overworld generation; src/nether.js and src/end.js for the other dimensions
src/structures.js     trees, dungeons, strongholds and nether fortresses
src/village.js        village layout and buildings; src/villagers.js holds professions and trades
src/world.js          one dimension's loaded chunks, edits, block entities and parked entities
src/blockupdates.js   neighbour updates, fluids, falling blocks, random ticks (crops, saplings, grass)
src/physics.js        swept AABB collision shared by the player and entities
src/player.js         player movement: walking, sprinting, sneaking, swimming, climbing, flying
src/entities.js       entity manager: items, arrows, fireballs, TNT, end crystals
src/mobs.js           mob definitions, AI and A* pathfinding; src/spawning.js decides where they appear
src/dragon.js         the Ender Dragon fight
src/portals.js        nether portal lighting and linking, end portal frames
src/commands.js       chat commands and Tab completion
src/advancements.js   advancements and the goal hint
src/weather.js        rain, snow, thunderstorms and lightning
src/mesher.js         light flood-fill and chunk meshing (culling, AO, smooth light, block models)
src/renderer.js       WebGL2: sky, chunks, water, entities, particles, held item, overlays
src/textures.js       procedural 16x16 block textures; src/sprites.js draws items; src/skins.js draws mobs
src/models.js         box models for the player, mobs and the dragon
src/streamer.js       loads and unloads chunks around the camera with a Web Worker pool (src/worker.js, src/jobs.js)
src/input.js          keyboard, mouse, pointer lock, drag-to-look and touch controls
src/audio.js          synthesized sound effects
```

- **Chunks.** The world is split into 16×16×128 chunks. Generation is a pure function of the seed and the coordinates, so chunks can be built in any order on any worker. Trees and structures that straddle chunk borders still line up.
- **Meshing.** To mesh a chunk, the main thread copies it plus an 8-block border from its neighbours into a "region" and hands that to a worker. The worker floods sunlight and block light through the region, then emits only the faces that touch air. Each vertex is 16 bytes: position, texture layer, light and AO.
- **The tick.** The game runs a fixed 20 ticks per second, as Minecraft does, and interpolates between ticks when drawing. Mobs, fluids, furnaces, crops and the dragon all live on the tick.
- **Edits.** Player edits are stored per chunk and re-applied whenever a chunk regenerates, so the world can stream in and out freely. Entities in chunks that unload are parked and come back when the chunk does.

## Tests

```sh
npm test
```

The tests use Node's built-in test runner. They cover:

- **World:** terrain determinism in all three dimensions, structures, cross-chunk trees, meshing and culling, lighting, raycasting, saving edits, and player physics.
- **Rules:** recipes, inventory clicking, furnaces, mining speeds and harvest tiers, flowing water and lava, falling blocks, crop and tree growth, portals, pathfinding, weather, enchanting and experience, advancements and commands.
