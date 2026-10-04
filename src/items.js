// Item registry. Inventories store plain { item, count, damage } stacks keyed
// by item name, so saves don't depend on numeric ids.
import { BLOCKS, B, RENDER_TYPE, RENDER } from './blocks.js';
import { textureIndex } from './textures.js';

export const ITEMS = {};
const order = [];

function add(key, props) {
  const item = { key, name: props.name, maxStack: 64, tab: 'materials', ...props };
  ITEMS[key] = item;
  order.push(key);
  return item;
}

export const TIERS = {
  wooden: { tier: 0, speed: 2, durability: 59, name: 'Wooden' },
  stone: { tier: 1, speed: 4, durability: 131, name: 'Stone' },
  iron: { tier: 2, speed: 6, durability: 250, name: 'Iron' },
  golden: { tier: 0, speed: 12, durability: 32, name: 'Golden' },
  diamond: { tier: 3, speed: 8, durability: 1561, name: 'Diamond' },
};
const ATTACK = {
  sword: { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7 },
  axe: { wooden: 3, stone: 4, iron: 5, golden: 3, diamond: 6 },
  pickaxe: { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5 },
  shovel: { wooden: 1.5, stone: 2.5, iron: 3.5, golden: 1.5, diamond: 4.5 },
  hoe: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1 },
};
const TOOL_NAMES = { sword: 'Sword', pickaxe: 'Pickaxe', axe: 'Axe', shovel: 'Shovel', hoe: 'Hoe' };

// ---- Blocks as items ----
// Blocks that come in several states are placed through one item with special placement.
const SPECIAL_BLOCK_ITEMS = {
  torch: { place: 'torch' },
  furnace: { place: 'facing', block: 'furnace' },
  chest: { place: 'facing', block: 'chest' },
  ladder: { place: 'ladder' },
};
const BLOCK_TAB = (b) => (b.plant || b.sapling ? 'nature' : 'blocks');

for (const b of BLOCKS) {
  if (b.id === 0 || b.item !== b.key) continue;
  if (b.hidden && !SPECIAL_BLOCK_ITEMS[b.key]) continue;
  const flat = RENDER_TYPE[b.id] === RENDER.CROSS;
  add(b.key, { name: b.name, block: b.key, tab: BLOCK_TAB(b), flat, ...(SPECIAL_BLOCK_ITEMS[b.key] || {}) });
}
// Variant families whose base block is hidden.
for (const [key, name, extra] of [
  ['furnace', 'Furnace', { place: 'facing', block: 'furnace' }],
  ['chest', 'Chest', { place: 'facing', block: 'chest' }],
  ['ladder', 'Ladder', { place: 'ladder', flatBlock: 'ladder_n' }],
]) {
  if (!ITEMS[key]) add(key, { name, tab: 'blocks', ...extra });
}
ITEMS.torch.flat = true;
ITEMS.torch.texName = 'torch';
ITEMS.ladder.flat = true;
ITEMS.ladder.texName = 'ladder';

// ---- Tools, weapons, armour ----
for (const [mat, t] of Object.entries(TIERS)) {
  for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
    add(`${mat}_${kind}`, {
      name: `${t.name} ${TOOL_NAMES[kind]}`,
      maxStack: 1,
      tab: kind === 'sword' ? 'combat' : 'tools',
      tool: { type: kind, tier: t.tier, speed: t.speed, durability: t.durability, damage: ATTACK[kind][mat], material: mat },
      fuel: mat === 'wooden' ? 1 : 0,
      use: kind === 'hoe' ? 'hoe' : undefined,
    });
  }
}
const ARMOR = {
  leather: { name: 'Leather', points: [1, 3, 2, 1], durability: [55, 80, 75, 65] },
  golden: { name: 'Golden', points: [2, 5, 3, 1], durability: [77, 112, 105, 91] },
  iron: { name: 'Iron', points: [2, 6, 5, 2], durability: [165, 240, 225, 195] },
  diamond: { name: 'Diamond', points: [3, 8, 6, 3], durability: [363, 528, 495, 429] },
};
const PIECES = [['helmet', 'Helmet', 'Cap'], ['chestplate', 'Chestplate', 'Tunic'], ['leggings', 'Leggings', 'Pants'], ['boots', 'Boots', 'Boots']];
for (const [mat, a] of Object.entries(ARMOR)) {
  PIECES.forEach(([piece, name, leatherName], slot) => {
    add(`${mat}_${piece}`, {
      name: mat === 'leather' ? `Leather ${leatherName}` : `${a.name} ${name}`,
      maxStack: 1,
      tab: 'combat',
      armor: { slot, points: a.points[slot], durability: a.durability[slot] },
    });
  });
}
add('bow', { name: 'Bow', maxStack: 1, tab: 'combat', use: 'bow', durability: 384, fuel: 1 });
add('arrow', { name: 'Arrow', tab: 'combat' });
add('shears', { name: 'Shears', maxStack: 1, tab: 'tools', tool: { type: 'shears', tier: 0, speed: 2, durability: 238, damage: 1 } });
add('flint_and_steel', { name: 'Flint and Steel', maxStack: 1, tab: 'tools', use: 'ignite', durability: 64 });
add('bucket', { name: 'Bucket', maxStack: 16, tab: 'tools', use: 'bucket' });
add('water_bucket', { name: 'Water Bucket', maxStack: 1, tab: 'tools', use: 'pour', fluid: 1 });
add('lava_bucket', { name: 'Lava Bucket', maxStack: 1, tab: 'tools', use: 'pour', fluid: 2, fuel: 100 });

// ---- Food ----
const food = (key, name, hunger, saturation, extra = {}) => add(key, { name, tab: 'food', food: { hunger, saturation, ...extra } });
food('apple', 'Apple', 4, 2.4);
food('golden_apple', 'Golden Apple', 4, 9.6, { regen: 5, always: true });
food('bread', 'Bread', 5, 6);
food('porkchop', 'Raw Porkchop', 3, 1.8);
food('cooked_porkchop', 'Cooked Porkchop', 8, 12.8);
food('beef', 'Raw Beef', 3, 1.8);
food('steak', 'Steak', 8, 12.8);
food('chicken', 'Raw Chicken', 2, 1.2, { poison: 0.3 });
food('cooked_chicken', 'Cooked Chicken', 6, 7.2);
food('mutton', 'Raw Mutton', 2, 1.2);
food('cooked_mutton', 'Cooked Mutton', 6, 9.6);
food('rotten_flesh', 'Rotten Flesh', 4, 0.8, { poison: 0.8 });
add('milk_bucket', { name: 'Milk Bucket', maxStack: 1, tab: 'food', food: { hunger: 0, saturation: 0, always: true, drink: true, cures: true, returns: 'bucket' } });

// ---- Materials ----
const mat = (key, name, extra = {}) => add(key, { name, ...extra });
mat('stick', 'Stick', { fuel: 0.5 });
mat('coal', 'Coal', { fuel: 8 });
mat('charcoal', 'Charcoal', { fuel: 8 });
mat('iron_ingot', 'Iron Ingot');
mat('gold_ingot', 'Gold Ingot');
mat('diamond', 'Diamond');
mat('flint', 'Flint');
mat('string', 'String');
mat('feather', 'Feather');
mat('gunpowder', 'Gunpowder');
mat('bone', 'Bone');
mat('bone_meal', 'Bone Meal', { use: 'bone_meal' });
mat('leather', 'Leather');
mat('brick', 'Brick');
mat('clay_ball', 'Clay Ball');
mat('paper', 'Paper');
mat('book', 'Book');
mat('wheat', 'Wheat');
mat('wheat_seeds', 'Wheat Seeds', { use: 'plant', plants: 'wheat_0', tab: 'nature' });
mat('sugar_cane', 'Sugar Cane', { use: 'plant', plants: 'sugar_cane', tab: 'nature' });
mat('red_dye', 'Red Dye');
mat('yellow_dye', 'Yellow Dye');
mat('glowstone_dust', 'Glowstone Dust');
mat('quartz', 'Nether Quartz');
mat('ender_pearl', 'Ender Pearl', { maxStack: 16, use: 'throw_pearl' });
mat('blaze_rod', 'Blaze Rod', { fuel: 12 });
mat('blaze_powder', 'Blaze Powder');
mat('eye_of_ender', 'Eye of Ender', { use: 'eye' });
add('oak_door', { name: 'Oak Door', tab: 'blocks', use: 'door' });
add('bed', { name: 'Bed', maxStack: 1, tab: 'blocks', use: 'bed' });

// Wooden blocks burn in a furnace too.
for (const key of ['planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'crafting_table', 'bookshelf', 'chest', 'ladder', 'oak_slab']) {
  if (ITEMS[key]) ITEMS[key].fuel = key.endsWith('slab') ? 0.75 : 1.5;
}
for (const key of ['oak_sapling', 'birch_sapling', 'spruce_sapling']) ITEMS[key].fuel = 0.5;

// Texture layer used when an item is drawn as a flat sprite; -1 means "draw the block".
for (const key of order) {
  const item = ITEMS[key];
  if (item.texName) {
    item.layer = textureIndex(item.texName);
  } else if (item.block && !item.flat) {
    item.layer = -1;
  } else if (item.block && item.flat) {
    item.layer = textureIndex(BLOCKS[B[item.block.toUpperCase()]].tex);
  } else if (['furnace', 'chest'].includes(key)) {
    item.layer = -1;
  } else {
    item.layer = textureIndex(`item_${key}`);
  }
  item.blockId = item.block ? B[item.block.toUpperCase()] : undefined;
  // The block drawn for this item's icon and in the hand.
  item.displayId = { furnace: B.FURNACE_S, chest: B.CHEST_S }[key] ?? item.blockId;
  if (item.tool && !item.durability) item.durability = item.tool.durability;
  if (item.armor && !item.durability) item.durability = item.armor.durability;
}

export const ITEM_ORDER = order;
export const CREATIVE_TABS = [
  ['blocks', 'Building'],
  ['nature', 'Nature'],
  ['tools', 'Tools'],
  ['combat', 'Combat'],
  ['food', 'Food'],
  ['materials', 'Materials'],
];

export function itemOf(key) {
  return ITEMS[key];
}

export function maxStack(key) {
  return ITEMS[key]?.maxStack ?? 64;
}

export function stack(item, count = 1, damage = 0) {
  return { item, count, damage };
}

export function itemName(key) {
  return ITEMS[key]?.name ?? key;
}

// Item given back for a block (pick block, block drops). Null when there is none.
export function itemForBlock(id) {
  const key = BLOCKS[id]?.item;
  return key && ITEMS[key] ? key : null;
}

// Loose name matching for commands: "diamond pickaxe", "Diamond_Pickaxe", "minecraft:diamond_pickaxe".
export function findItem(text) {
  const key = String(text).toLowerCase().replace(/^minecraft:/, '').trim().replace(/\s+/g, '_');
  if (ITEMS[key]) return key;
  const aliases = { oak_planks: 'planks', grass_block: 'grass', wool: 'wool_white', white_wool: 'wool_white', log: 'oak_log', wood: 'oak_log', seeds: 'wheat_seeds', porkchop_cooked: 'cooked_porkchop', beef_cooked: 'steak', cooked_beef: 'steak' };
  return aliases[key] && ITEMS[aliases[key]] ? aliases[key] : null;
}
