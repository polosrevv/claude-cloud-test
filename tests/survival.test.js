import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B, BLOCKS, FLUID, FLUID_LEVEL } from '../src/blocks.js';
import { ITEMS } from '../src/items.js';
import { RECIPES, TAGS, SMELTING, matchRecipe } from '../src/recipes.js';
import { Inventory, PlayerInventory, clickSlot, quickMove, takeCraft, newFurnace, tickFurnace, SMELT_TICKS } from '../src/inventory.js';
import { breakSeconds, canHarvest, dropsFor, blockXp } from '../src/drops.js';
import { runCommand, complete } from '../src/commands.js';
import { MOBS, createMob, createSlime, findPath } from '../src/mobs.js';
import { serializeEntity, deserializeEntity } from '../src/entities.js';
import { tryLightPortal, checkEndPortal } from '../src/portals.js';
import { ADVANCEMENTS } from '../src/advancements.js';
import { Weather } from '../src/weather.js';
import { ENCHANTMENTS, fits, enchantOffers, rollEnchantments, addPoints, totalPoints, xpToNext, splitXp } from '../src/enchantments.js';
import { clone, canStack } from '../src/inventory.js';
import { flatWorld, blockSim } from './helpers.js';

const grid = (rows) => rows.flat();

test('every recipe uses real items and makes a real item', () => {
  const known = (ing) => (ing.startsWith('#') ? TAGS[ing]?.every((i) => ITEMS[i]) : !!ITEMS[ing]);
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.result], r.result);
    const ings = r.type === 'shaped' ? Object.values(r.key) : r.ingredients;
    for (const ing of ings) assert.ok(known(ing), `${r.result} needs unknown ${ing}`);
  }
  for (const [input, output] of Object.entries(SMELTING)) {
    assert.ok(ITEMS[input], input);
    assert.ok(ITEMS[output], output);
  }
});

test('every item has a picture', () => {
  for (const item of Object.values(ITEMS)) {
    if (item.block || item.flatBlock) continue;
    assert.ok(item.layer >= 0, `${item.key} has no texture`);
  }
});

test('shaped recipes work anywhere in the grid and mirrored', () => {
  assert.deepEqual(matchRecipe(grid([['oak_log', null], [null, null]]), 2, 2), { item: 'planks', count: 4 });
  const pick = grid([
    ['cobblestone', 'cobblestone', 'cobblestone'],
    [null, 'stick', null],
    [null, 'stick', null],
  ]);
  assert.equal(matchRecipe(pick, 3, 3).item, 'stone_pickaxe');
  // An axe facing either way, shifted to the right edge.
  const axe = grid([
    [null, 'planks', 'planks'],
    [null, 'stick', 'planks'],
    [null, 'stick', null],
  ]);
  assert.equal(matchRecipe(axe, 3, 3).item, 'wooden_axe');
  // Any kind of planks counts as planks.
  const table = grid([['birch_planks', 'spruce_planks'], ['planks', 'birch_planks']]);
  assert.equal(matchRecipe(table, 2, 2).item, 'crafting_table');
  // Extra items spoil a recipe.
  assert.equal(matchRecipe(grid([['oak_log', 'dirt'], [null, null]]), 2, 2), null);
});

test('the full path to the End can be crafted', () => {
  const makes = new Set(RECIPES.map((r) => r.result));
  for (const item of ['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'iron_pickaxe', 'diamond_pickaxe',
    'bucket', 'flint_and_steel', 'blaze_powder', 'eye_of_ender', 'bow', 'arrow', 'bed', 'torch']) {
    assert.ok(makes.has(item), `no recipe for ${item}`);
  }
  assert.equal(SMELTING.iron_ore, 'iron_ingot');
});

test('crafting takes one of each ingredient', () => {
  const g = new Inventory(4);
  g.slots[0] = { item: 'oak_log', count: 3, damage: 0 };
  assert.deepEqual(takeCraft(g, 2), { item: 'planks', count: 4, damage: 0 });
  assert.equal(g.slots[0].count, 2);
  g.slots[0].count = 1;
  takeCraft(g, 2);
  assert.equal(g.slots[0], null);
  assert.equal(takeCraft(g, 2), null);
});

test('inventories stack, split and swap like Minecraft', () => {
  const inv = new PlayerInventory();
  assert.equal(inv.give({ item: 'dirt', count: 100 }), 0);
  assert.equal(inv.main.slots[0].count, 64);
  assert.equal(inv.main.slots[1].count, 36);
  assert.equal(inv.give({ item: 'iron_sword', count: 1 }), 0);
  assert.equal(inv.main.count('dirt'), 100);

  const holder = { cursor: null };
  const slot = (i) => ({ inv: inv.main, index: i, kind: 'normal' });
  clickSlot(holder, slot(1), 2); // right click: pick up half
  assert.equal(holder.cursor.count, 18);
  assert.equal(inv.main.slots[1].count, 18);
  clickSlot(holder, slot(5), 2); // right click on empty: drop one
  assert.equal(inv.main.slots[5].count, 1);
  assert.equal(holder.cursor.count, 17);
  clickSlot(holder, slot(1), 0); // left click on the same item: merge
  assert.equal(inv.main.slots[1].count, 35);
  assert.equal(holder.cursor, null);

  // Armour slots only take the right piece.
  const head = { inv: inv.armor, index: 0, kind: 'armor', armorSlot: 0 };
  holder.cursor = { item: 'iron_boots', count: 1, damage: 0 };
  clickSlot(holder, head, 0);
  assert.equal(inv.armor.slots[0], null);
  holder.cursor = { item: 'iron_helmet', count: 1, damage: 0 };
  clickSlot(holder, head, 0);
  assert.equal(inv.armor.slots[0].item, 'iron_helmet');
  assert.equal(inv.armorPoints(), 2);

  // Shift-click moves a stack into the first slots with room.
  const chest = new Inventory(27);
  quickMove(slot(0), chest.slots.map((_, i) => ({ inv: chest, index: i, kind: 'normal' })));
  assert.equal(inv.main.slots[0], null);
  assert.equal(chest.slots[0].count, 64);
});

test('saved inventories come back and unknown items are dropped', () => {
  const inv = new PlayerInventory();
  inv.give({ item: 'diamond', count: 5 });
  inv.armor.slots[1] = { item: 'iron_chestplate', count: 1, damage: 30 };
  const data = JSON.parse(JSON.stringify(inv.serialize()));
  data.main[3] = { item: 'no_such_thing', count: 1 };
  const back = new PlayerInventory();
  back.load(data);
  assert.equal(back.main.count('diamond'), 5);
  assert.equal(back.armor.slots[1].damage, 30);
  assert.equal(back.main.slots[3], null);
});

test('furnaces burn fuel and smelt one item every ten seconds', () => {
  const f = newFurnace();
  f.slots[0] = { item: 'iron_ore', count: 3, damage: 0 };
  f.slots[1] = { item: 'coal', count: 1, damage: 0 };
  let changes = 0;
  for (let i = 0; i < SMELT_TICKS * 3 + 5; i++) if (tickFurnace(f)) changes++;
  assert.deepEqual(f.slots[2], { item: 'iron_ingot', count: 3, damage: 0 });
  assert.equal(f.slots[1], null, 'one coal smelts eight items');
  assert.equal(f.slots[0], null);
  assert.ok(changes >= 1);
  // Nothing to smelt: no fuel is wasted.
  const idle = newFurnace();
  idle.slots[1] = { item: 'coal', count: 1, damage: 0 };
  tickFurnace(idle);
  assert.equal(idle.slots[1].count, 1);
});

test('mining speed and harvesting follow the tool rules', () => {
  // Minecraft's numbers: 0.75 s for dirt by hand, 7.5 s for stone by hand, 1.15 s with a wooden pickaxe.
  assert.equal(breakSeconds(B.DIRT, null), 0.75);
  assert.equal(breakSeconds(B.STONE, null), 7.5);
  assert.equal(breakSeconds(B.STONE, 'wooden_pickaxe'), 1.15);
  assert.equal(breakSeconds(B.OAK_LOG, null), 3);
  assert.equal(breakSeconds(B.BEDROCK, 'diamond_pickaxe'), Infinity);
  assert.equal(breakSeconds(B.POPPY, null), 0);
  assert.ok(breakSeconds(B.STONE, 'wooden_pickaxe', { inWater: true }) > 5);

  assert.equal(canHarvest(B.STONE, null), false);
  assert.equal(canHarvest(B.IRON_ORE, 'wooden_pickaxe'), false);
  assert.equal(canHarvest(B.IRON_ORE, 'stone_pickaxe'), true);
  assert.equal(canHarvest(B.DIAMOND_ORE, 'stone_pickaxe'), false);
  assert.equal(canHarvest(B.DIAMOND_ORE, 'iron_pickaxe'), true);
  assert.equal(canHarvest(B.OBSIDIAN, 'iron_pickaxe'), false);
  assert.equal(canHarvest(B.OBSIDIAN, 'diamond_pickaxe'), true);

  assert.deepEqual(dropsFor(B.STONE, 'wooden_pickaxe'), [{ item: 'cobblestone', count: 1 }]);
  assert.deepEqual(dropsFor(B.STONE, null), []);
  assert.deepEqual(dropsFor(B.GRASS, null), [{ item: 'dirt', count: 1 }]);
  assert.equal(dropsFor(B.DIAMOND_ORE, 'iron_pickaxe')[0].item, 'diamond');
  assert.equal(dropsFor(B.COAL_ORE, 'wooden_pickaxe')[0].item, 'coal');
});

test('every placeable block can be broken or is unbreakable on purpose', () => {
  for (const b of BLOCKS) {
    if (b.id === 0 || FLUID[b.id]) continue;
    assert.ok(typeof b.hardness === 'number', `${b.key} has no hardness`);
  }
});

test('water spreads seven blocks, flows down and dries up when the source goes', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  w.setBlock(0, 11, 0, B.WATER);
  sim.run(80);
  assert.equal(FLUID[w.getBlock(7, 11, 0)], 1);
  assert.equal(FLUID_LEVEL[w.getBlock(7, 11, 0)], 7);
  assert.equal(w.getBlock(8, 11, 0), B.AIR);
  w.setBlock(0, 11, 0, B.AIR);
  sim.run(120);
  let wet = 0;
  for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) if (FLUID[w.getBlock(x, 11, z)]) wet++;
  assert.equal(wet, 0);

  // Off a ledge it falls straight down.
  w.setBlock(3, 10, 3, B.AIR);
  w.setBlock(3, 9, 3, B.AIR);
  w.setBlock(2, 11, 3, B.WATER);
  sim.run(60);
  assert.equal(FLUID[w.getBlock(3, 9, 3)], 1);
});

test('two water sources make a third, and lava meeting water hardens', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  // A trench one block wide: sources at both ends fill the middle.
  for (let x = -2; x <= 2; x++) w.setBlock(x, 10, 5, B.AIR);
  w.setBlock(-1, 10, 5, B.WATER);
  w.setBlock(1, 10, 5, B.WATER);
  sim.run(40);
  assert.equal(w.getBlock(0, 10, 5), B.WATER, 'the middle became a source');

  w.setBlock(6, 11, 0, B.LAVA);
  sim.run(5);
  w.setBlock(7, 11, 0, B.WATER);
  sim.run(40);
  assert.equal(w.getBlock(6, 11, 0), B.OBSIDIAN);
});

test('plants pop off and sand falls when their support goes', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  w.setBlock(4, 11, 4, B.DIRT);
  w.setBlock(4, 12, 4, B.POPPY);
  w.setBlock(4, 11, 4, B.AIR);
  sim.run(1);
  assert.equal(w.getBlock(4, 12, 4), B.AIR);
  assert.equal(sim.broken[0][3], B.POPPY);

  w.setBlock(6, 15, 6, B.SAND);
  sim.run(1);
  assert.equal(w.getBlock(6, 15, 6), B.AIR);
  assert.equal(w.getBlock(6, 11, 6), B.SAND);

  w.setBlock(8, 11, 8, B.TORCH);
  w.setBlock(8, 10, 8, B.AIR);
  sim.run(1);
  assert.equal(w.getBlock(8, 11, 8), B.AIR);
});

test('wheat grows in light and saplings grow into trees', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  w.setBlock(2, 10, 2, B.FARMLAND);
  w.setBlock(2, 11, 2, B.WHEAT_0);
  for (let i = 0; i < 200 && w.getBlock(2, 11, 2) !== B.WHEAT_7; i++) sim.updater.randomTick(2, 11, 2, w.getBlock(2, 11, 2), w.getChunk(0, 0));
  assert.equal(w.getBlock(2, 11, 2), B.WHEAT_7);
  const ripe = dropsFor(B.WHEAT_7, null);
  assert.equal(ripe[0].item, 'wheat');

  w.setBlock(-5, 10, -5, B.DIRT);
  w.setBlock(-5, 11, -5, B.OAK_SAPLING);
  for (let i = 0; i < 400 && w.getBlock(-5, 11, -5) === B.OAK_SAPLING; i++) sim.updater.randomTick(-5, 11, -5, B.OAK_SAPLING, w.getChunk(-1, -1));
  assert.equal(w.getBlock(-5, 11, -5), B.OAK_LOG);
  assert.equal(w.getBlock(-5, 12, -5), B.OAK_LOG);
});

test('an obsidian frame lights into a nether portal and breaks with it', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  const x = 2;
  const y = 11;
  const z = 3;
  for (let dx = -1; dx <= 2; dx++) {
    for (let h = -1; h <= 3; h++) {
      const frame = dx === -1 || dx === 2 || h === -1 || h === 3;
      w.setBlock(x + dx, y + h, z, frame ? B.OBSIDIAN : B.AIR);
    }
  }
  assert.ok(tryLightPortal(w, x, y, z));
  assert.ok(BLOCKS[w.getBlock(x, y, z)].portal === 'nether');
  assert.ok(BLOCKS[w.getBlock(x + 1, y + 2, z)].portal === 'nether');
  // A frame with a gap doesn't light.
  assert.equal(tryLightPortal(w, 9, 11, 9), false);
  // Breaking the frame collapses the portal.
  w.setBlock(x + 2, y + 1, z, B.AIR);
  sim.run(3);
  assert.equal(w.getBlock(x + 1, y + 1, z), B.AIR);
});

test('twelve filled frames open the End portal', () => {
  const w = flatWorld(1, 10);
  const y = 11;
  const ring = [];
  for (let k = -1; k <= 1; k++) ring.push([k, -2], [k, 2], [-2, k], [2, k]);
  for (const [dx, dz] of ring) w.setBlock(dx, y, dz, B.END_PORTAL_FRAME_EYE);
  w.setBlock(2, y, 1, B.END_PORTAL_FRAME);
  assert.equal(checkEndPortal(w, 2, y, 0), false);
  w.setBlock(2, y, 1, B.END_PORTAL_FRAME_EYE);
  assert.ok(checkEndPortal(w, 2, y, 1));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) assert.equal(w.getBlock(dx, y, dz), B.END_PORTAL);
});

test('mobs find a path around a wall', () => {
  const w = flatWorld(1, 10);
  for (let z = -3; z <= 3; z++) for (let y = 11; y <= 13; y++) w.setBlock(4, y, z, B.STONE);
  const path = findPath(w, [0, 11, 0], [8, 11, 0], 2);
  assert.ok(path && path.length > 8, 'found a way round');
  for (const [x, y, z] of path) assert.equal(w.getBlock(x, y, z), B.AIR);
});

test('every mob type can be created', () => {
  for (const type of Object.keys(MOBS)) {
    const m = createMob(type, 0, 20, 0);
    assert.equal(m.health, MOBS[type].health);
    assert.ok(m.box()[4] > m.box()[1]);
  }
});

test('the advancements form a path to the dragon', () => {
  const ids = ADVANCEMENTS.map((a) => a.id);
  for (const id of ['wood', 'iron', 'nether', 'blaze_rod', 'eye', 'end', 'dragon']) assert.ok(ids.includes(id), id);
  for (const a of ADVANCEMENTS) for (const item of a.has ?? []) assert.ok(ITEMS[item], `${a.id} wants unknown ${item}`);
});

function commandGame() {
  const w = flatWorld(1, 10);
  const inventory = new PlayerInventory();
  const game = {
    cheats: true,
    world: w,
    inventory,
    player: { pos: [0.5, 11, 0.5], eye: [0.5, 12.6, 0.5], look: [0, 0, -1], health: 10, food: 3 },
    hud: { refreshHotbar() {} },
    entities: { list: [], add(e) { this.list.push(e); } },
    dayTicks: 0,
    weather: new Weather(),
    difficulty: 'normal',
    gamerules: { keepInventory: false },
    seedText: 'abc',
    setTime(t) { this.dayTicks = t; },
    setGameMode(m) { this.mode = m; },
    teleportPlayer(x, y, z) { this.player.pos = [x, y, z]; },
    dropStacks() {},
  };
  return game;
}

test('commands change the world', () => {
  const g = commandGame();
  runCommand(g, '/give diamond 70');
  assert.equal(g.inventory.main.count('diamond'), 70);
  runCommand(g, '/time set night');
  assert.equal(g.dayTicks, 13000);
  runCommand(g, '/gamemode c');
  assert.equal(g.mode, 'creative');
  runCommand(g, '/tp ~1 20 ~-2');
  assert.deepEqual(g.player.pos, [1.5, 20, -1.5]);
  runCommand(g, '/setblock 1 11 1 glowstone');
  assert.equal(g.world.getBlock(1, 11, 1), B.GLOWSTONE);
  const out = runCommand(g, '/fill 0 11 0 2 12 2 planks');
  assert.match(out[0].text, /filled 18 blocks/);
  runCommand(g, '/summon zombie 3 11 3');
  assert.equal(g.entities.list[0].type, 'zombie');
  runCommand(g, '/gamerule keepInventory true');
  assert.equal(g.gamerules.keepInventory, true);
  runCommand(g, '/weather thunder 60');
  assert.ok(g.weather.state.raining && g.weather.state.thundering);
  assert.equal(g.weather.state.rainTime, 1200);
  runCommand(g, '/heal');
  assert.equal(g.player.health, 20);
  assert.equal(runCommand(g, '/nonsense')[0].kind, 'error');
  assert.equal(runCommand(g, '/give not_an_item')[0].kind, 'error');
});

test('commands need cheats, except the harmless ones', () => {
  const g = commandGame();
  g.cheats = false;
  assert.equal(runCommand(g, '/give diamond')[0].kind, 'error');
  assert.equal(g.inventory.main.count('diamond'), 0);
  assert.match(runCommand(g, '/seed')[0].text, /abc/);
});

test('tab completion suggests commands and arguments', () => {
  assert.ok(complete('/ga').includes('/gamemode'));
  assert.ok(complete('/give diam').some((c) => c.endsWith('diamond')));
  assert.ok(complete('/summon cr').some((c) => c.endsWith('creeper')));
});

test('rain comes and goes, and only falls where the sky is open', () => {
  const w = flatWorld(1, 10);
  const weather = new Weather();
  assert.equal(weather.state.raining, false);
  const game = { world: w, player: { pos: [0, 11, 0] }, gamerules: {}, particles: { burst() {} }, sound() {}, tickCount: 0, difficulty: 'normal' };
  weather.set('rain', 400);
  for (let i = 0; i < 120; i++) weather.tick(game);
  assert.equal(weather.rain, 1);
  // Find a column where rain (not snow) falls on this seed.
  let x = 0;
  while (weather.kindAt(w, x, 0) !== 'rain' && x < 15) x++;
  assert.equal(weather.kindAt(w, x, 0), 'rain');
  assert.equal(weather.topAt(w, x, 0), 10);
  assert.ok(weather.wet(w, x + 0.5, 11, 0.5));
  w.setBlock(x, 14, 0, B.STONE);
  assert.equal(weather.wet(w, x + 0.5, 11, 0.5), false, 'a roof keeps the rain off');
  // When the shower's time runs out the sky clears.
  for (let i = 0; i < 400; i++) weather.tick(game);
  assert.equal(weather.state.raining, false);
  for (let i = 0; i < 120; i++) weather.tick(game);
  assert.equal(weather.rain, 0);
  // The Nether never sees rain.
  assert.equal(weather.kindAt({ dimension: 'nether' }, 0, 0), null);
});

test('experience levels follow Minecraft\'s curve', () => {
  assert.equal(xpToNext(0), 7);
  assert.equal(xpToNext(15), 37);
  assert.equal(xpToNext(30), 112);
  let st = addPoints({ level: 0, progress: 0 }, 7);
  assert.deepEqual(st, { level: 1, progress: 0 });
  st = addPoints({ level: 0, progress: 0 }, 1395); // exactly level 30
  assert.equal(st.level, 30);
  assert.equal(totalPoints(st), 1395);
  assert.deepEqual(addPoints({ level: 2, progress: 0 }, -1).level, 1);
  assert.equal(splitXp(100).reduce((a, b) => a + b, 0), 100);
  assert.ok(blockXp(B.DIAMOND_ORE) >= 3 && blockXp(B.DIAMOND_ORE) <= 7);
  assert.equal(blockXp(B.STONE), 0);
});

test('enchantments only go on the right items', () => {
  assert.ok(fits('efficiency', 'diamond_pickaxe'));
  assert.ok(fits('sharpness', 'iron_sword'));
  assert.ok(!fits('sharpness', 'iron_pickaxe'));
  assert.ok(fits('protection', 'iron_chestplate'));
  assert.ok(fits('feather_falling', 'diamond_boots'));
  assert.ok(!fits('feather_falling', 'diamond_helmet'));
  assert.ok(fits('infinity', 'bow'));
  assert.ok(fits('unbreaking', 'shears'));
  assert.ok(!fits('unbreaking', 'dirt'));
  for (const key of Object.keys(ENCHANTMENTS)) assert.ok(ENCHANTMENTS[key].max >= 1);
});

test('the enchanting table offers more with more bookshelves', () => {
  const seed = 1234;
  const none = enchantOffers('diamond_pickaxe', 0, seed);
  const full = enchantOffers('diamond_pickaxe', 15, seed);
  assert.deepEqual(enchantOffers('diamond_pickaxe', 15, seed), full, 'offers are stable for a seed');
  assert.ok(none.every((o) => !o || o.cost <= 8));
  assert.equal(full[2].cost, 30);
  for (const o of full) {
    assert.ok(o.ench.length >= 1);
    for (const e of o.ench) {
      assert.ok(fits(e.key, 'diamond_pickaxe'));
      assert.ok(e.level >= 1 && e.level <= ENCHANTMENTS[e.key].max);
    }
    // Silk Touch and Fortune never come together.
    const keys = o.ench.map((e) => e.key);
    assert.ok(!(keys.includes('silk_touch') && keys.includes('fortune')));
  }
  assert.deepEqual(enchantOffers('dirt', 15, seed), [null, null, null]);
  // A level-30 roll on a sword is a damage enchantment or something compatible with one.
  for (let i = 0; i < 50; i++) {
    const roll = rollEnchantments('diamond_sword', 30, i);
    const damage = roll.filter((e) => ['sharpness', 'smite', 'bane_of_arthropods'].includes(e.key));
    assert.ok(damage.length <= 1);
  }
});

test('enchantments change mining and drops', () => {
  assert.ok(breakSeconds(B.STONE, 'iron_pickaxe', { efficiency: 5 }) < breakSeconds(B.STONE, 'iron_pickaxe'));
  // Efficiency does nothing when the tool is wrong for the block.
  assert.equal(breakSeconds(B.STONE, 'iron_shovel', { efficiency: 5 }), breakSeconds(B.STONE, 'iron_shovel'));
  assert.deepEqual(dropsFor(B.STONE, 'iron_pickaxe', { silk: true }), [{ item: 'stone', count: 1 }]);
  assert.deepEqual(dropsFor(B.DIAMOND_ORE, 'iron_pickaxe', { silk: true }), [{ item: 'diamond_ore', count: 1 }]);
  assert.deepEqual(dropsFor(B.GLASS, null, { silk: true }), [{ item: 'glass', count: 1 }]);
  let most = 0;
  for (let i = 0; i < 200; i++) most = Math.max(most, dropsFor(B.DIAMOND_ORE, 'iron_pickaxe', { fortune: 3 })[0].count);
  assert.equal(most, 4);
});

test('enchanted stacks keep their enchantments and never stack', () => {
  const s = { item: 'diamond_sword', count: 1, damage: 5, ench: { sharpness: 3 } };
  const c = clone(s);
  assert.deepEqual(c.ench, { sharpness: 3 });
  c.ench.sharpness = 1;
  assert.equal(s.ench.sharpness, 3, 'a copy, not a reference');
  assert.equal(canStack({ item: 'bow', count: 1, ench: { power: 1 } }, { item: 'bow', count: 1 }), false);
});

test('slimes come in three sizes and tamed wolves are remembered', () => {
  for (const size of [1, 2, 4]) {
    const slime = createSlime(size, 0, 20, 0);
    assert.equal(slime.health, size * size);
    const b = slime.box();
    assert.ok(Math.abs(b[4] - b[1] - 0.51 * size) < 1e-9);
    // Hostile mobs aren't saved unless they're persistent.
    assert.equal(serializeEntity(slime), null);
    slime.persistent = true;
    assert.equal(deserializeEntity(JSON.parse(JSON.stringify(serializeEntity(slime)))).size, size);
  }
  const wolf = createMob('wolf', 3, 20, 4);
  wolf.tamed = true;
  wolf.sitting = true;
  const back = deserializeEntity(JSON.parse(JSON.stringify(serializeEntity(wolf))));
  assert.equal(back.tamed, true);
  assert.equal(back.sitting, true);
  // Squid drift off when you leave, like hostile mobs.
  assert.equal(serializeEntity(createMob('squid', 0, 40, 0)), null);
});

test('fences and panes join their neighbours, and fences are too tall to jump', async () => {
  const { connectMask, connectShapes } = await import('../src/blocks.js');
  const { Player } = await import('../src/player.js');
  const w = flatWorld(1, 10);
  w.setBlock(2, 11, 2, B.OAK_FENCE);
  w.setBlock(3, 11, 2, B.OAK_FENCE);
  w.setBlock(2, 11, 1, B.STONE);
  w.setBlock(1, 11, 2, B.GLASS_PANE);
  const at = (x, z) => (dx, dz) => w.getBlock(x + dx, 11, z + dz);
  assert.equal(connectMask(B.OAK_FENCE, at(2, 2)), 1 | 2, 'joins the stone to the north and the fence to the east, not the pane');
  assert.equal(connectMask(B.GLASS_PANE, at(1, 2)), 0, 'panes only join solid cubes and other panes');
  assert.equal(connectShapes(B.OAK_FENCE, 0)[0][4], 1.5);
  // A row of fence across the path stops a jumping player.
  for (let z = -6; z <= 6; z++) w.setBlock(6, 11, z, B.OAK_FENCE);
  const p = new Player();
  p.teleport(4.5, 11, 0.5);
  p.yaw = -Math.PI / 2;
  for (let i = 0; i < 180; i++) p.update(1 / 60, { forward: 1, strafe: 0, jump: true, sneak: false, sprint: false }, w);
  // The post's face is at x = 6.375, so the player's centre stops 0.3 short of it.
  assert.ok(p.pos[0] < 6.1, `got over the fence to x=${p.pos[0]}`);
});

test('cake crafting hands back the milk buckets', () => {
  const grid = new Inventory(9);
  const put = (i, item) => { grid.slots[i] = { item, count: 1, damage: 0 }; };
  [0, 1, 2].forEach((i) => put(i, 'milk_bucket'));
  put(3, 'sugar'); put(4, 'egg'); put(5, 'sugar');
  [6, 7, 8].forEach((i) => put(i, 'wheat'));
  assert.deepEqual(takeCraft(grid, 3), { item: 'cake', count: 1, damage: 0 });
  assert.deepEqual(grid.slots.map((s) => s?.item ?? null), ['bucket', 'bucket', 'bucket', null, null, null, null, null, null]);
});

test('ripe stems set fruit beside them', () => {
  const w = flatWorld(1, 10);
  const sim = blockSim(w);
  w.setBlock(4, 10, 4, B.FARMLAND);
  w.setBlock(4, 11, 4, B.PUMPKIN_STEM_7);
  w.setBlock(5, 10, 4, B.WATER);
  for (const [x, z] of [[3, 4], [4, 3], [4, 5]]) w.setBlock(x, 10, z, B.DIRT);
  for (let i = 0; i < 300; i++) sim.updater.randomTick(4, 11, 4, B.PUMPKIN_STEM_7, w.getChunk(0, 0));
  let fruit = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (BLOCKS[w.getBlock(4 + dx, 11, 4 + dz)].key.startsWith('pumpkin_')) fruit++;
  assert.equal(fruit, 1, 'exactly one pumpkin');
  assert.equal(w.getBlock(4, 11, 4), B.PUMPKIN_STEM_7, 'the stem stays');
});

test('villages are laid out deterministically, with residents and real trades', async () => {
  const { createTerrain } = await import('../src/terrain.js');
  const { tradesFor, PROFESSIONS } = await import('../src/villagers.js');
  const a = createTerrain(99).locate('village', 0, 0);
  const b = createTerrain(99).locate('village', 0, 0);
  assert.deepEqual(a, b);
  const t = createTerrain(99);
  // The well sits at the centre: water with a cobblestone ring.
  const cx = Math.floor(a.x / 16);
  const cz = Math.floor(a.z / 16);
  const data = t.generateChunk(cx, cz);
  const at = (x, y, z) => data[((y * 16) + (z - cz * 16)) * 16 + (x - cx * 16)];
  assert.equal(at(a.x, a.y, a.z), B.WATER);
  assert.equal(at(a.x + 1, a.y + 1, a.z), B.COBBLESTONE);
  let residents = [];
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) residents = residents.concat(t.residentsIn(cx + dx, cz + dz));
  assert.ok(residents.some((r) => r.type === 'iron_golem'));
  assert.ok(residents.filter((r) => r.type === 'villager').length >= 2);
  for (const prof of Object.keys(PROFESSIONS)) {
    const trades = tradesFor(prof, 42);
    assert.deepEqual(trades, tradesFor(prof, 42));
    assert.ok(trades.length >= 4);
    for (const tr of trades) {
      for (const g of tr.give) assert.ok(ITEMS[g.item], `${prof} wants unknown ${g.item}`);
      assert.ok(ITEMS[tr.get.item], `${prof} sells unknown ${tr.get.item}`);
      assert.ok(tr.give.some((g) => g.item === 'emerald') || tr.get.item === 'emerald');
    }
  }
});
