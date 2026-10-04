// Crafting and smelting recipes. Ingredients are item names or tags ('#planks').
import { ITEMS } from './items.js';

export const TAGS = {
  '#planks': ['planks', 'birch_planks', 'spruce_planks'],
  '#logs': ['oak_log', 'birch_log', 'spruce_log'],
  '#wool': ['wool_white', 'wool_red', 'wool_yellow', 'wool_lime', 'wool_blue', 'wool_black'],
  '#coals': ['coal', 'charcoal'],
};

export const RECIPES = [];

function shaped(result, count, pattern, key) {
  RECIPES.push({ type: 'shaped', result, count, pattern, key, w: Math.max(...pattern.map((r) => r.length)), h: pattern.length });
}
function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result, count, ingredients });
}

shapeless('planks', 4, ['oak_log']);
shapeless('birch_planks', 4, ['birch_log']);
shapeless('spruce_planks', 4, ['spruce_log']);
shaped('stick', 4, ['#', '#'], { '#': '#planks' });
shaped('crafting_table', 1, ['##', '##'], { '#': '#planks' });
shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' });
shaped('chest', 1, ['###', '# #', '###'], { '#': '#planks' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });

const TOOL_MATERIAL = { wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [mat, x] of Object.entries(TOOL_MATERIAL)) {
  const key = { X: x, S: 'stick' };
  shaped(`${mat}_pickaxe`, 1, ['XXX', ' S ', ' S '], key);
  shaped(`${mat}_axe`, 1, ['XX', 'XS', ' S'], key);
  shaped(`${mat}_shovel`, 1, ['X', 'S', 'S'], key);
  shaped(`${mat}_sword`, 1, ['X', 'X', 'S'], key);
  shaped(`${mat}_hoe`, 1, ['XX', ' S', ' S'], key);
}
const ARMOR_MATERIAL = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [mat, x] of Object.entries(ARMOR_MATERIAL)) {
  const key = { X: x };
  shaped(`${mat}_helmet`, 1, ['XXX', 'X X'], key);
  shaped(`${mat}_chestplate`, 1, ['X X', 'XXX', 'XXX'], key);
  shaped(`${mat}_leggings`, 1, ['XXX', 'X X', 'X X'], key);
  shaped(`${mat}_boots`, 1, ['X X', 'X X'], key);
}
shaped('bow', 1, [' TS', 'T S', ' TS'], { T: 'stick', S: 'string' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('bed', 1, ['WWW', 'PPP'], { W: '#wool', P: '#planks' });
shaped('wool_white', 1, ['SS', 'SS'], { S: 'string' });
shapeless('wool_red', 1, ['red_dye', 'wool_white']);
shapeless('wool_yellow', 1, ['yellow_dye', 'wool_white']);
shapeless('red_dye', 1, ['poppy']);
shapeless('yellow_dye', 1, ['dandelion']);
shapeless('bone_meal', 3, ['bone']);
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' });
shaped('glowstone', 1, ['DD', 'DD'], { D: 'glowstone_dust' });
for (const [block, ingot] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond']]) {
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: ingot });
  shapeless(ingot, 9, [block]);
}
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('oak_door', 3, ['PP', 'PP', 'PP'], { P: '#planks' });
shaped('stone_slab', 6, ['SSS'], { S: 'stone' });
shaped('oak_slab', 6, ['PPP'], { P: '#planks' });
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shapeless('blaze_powder', 2, ['blaze_rod']);
shapeless('eye_of_ender', 1, ['ender_pearl', 'blaze_powder']);
shaped('enchanting_table', 1, [' B ', 'DOD', 'OOO'], { B: 'book', D: 'diamond', O: 'obsidian' });
shaped('lapis_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'lapis_lazuli' });
shaped('gold_ingot', 1, ['XXX', 'XXX', 'XXX'], { X: 'gold_nugget' });
// Building blocks
for (const [stairs, mat] of [['oak_stairs', '#planks'], ['cobblestone_stairs', 'cobblestone'], ['stone_brick_stairs', 'stone_bricks'], ['brick_stairs', 'bricks'], ['sandstone_stairs', 'sandstone']]) {
  shaped(stairs, 4, ['X  ', 'XX ', 'XXX'], { X: mat });
}
shaped('oak_fence', 3, ['PSP', 'PSP'], { P: '#planks', S: 'stick' });
shaped('nether_brick_fence', 6, ['NNN', 'NNN'], { N: 'nether_bricks' });
shaped('oak_fence_gate', 1, ['SPS', 'SPS'], { P: '#planks', S: 'stick' });
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
shaped('iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' });
shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'pumpkin', T: 'torch' });
shapeless('pumpkin_seeds', 4, ['pumpkin']);
shapeless('melon_seeds', 1, ['melon_slice']);
shaped('melon', 1, ['MMM', 'MMM', 'MMM'], { M: 'melon_slice' });
// Food
shapeless('sugar', 1, ['sugar_cane']);
shaped('bowl', 4, ['P P', ' P '], { P: '#planks' });
shapeless('mushroom_stew', 1, ['bowl', 'brown_mushroom', 'red_mushroom']);
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('cake', 1, ['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' });
// Dyes and wool
shapeless('orange_dye', 2, ['red_dye', 'yellow_dye']);
shapeless('pink_dye', 2, ['red_dye', 'bone_meal']);
shapeless('gray_dye', 2, ['ink_sac', 'bone_meal']);
shapeless('light_gray_dye', 2, ['gray_dye', 'bone_meal']);
shapeless('light_blue_dye', 2, ['lapis_lazuli', 'bone_meal']);
shapeless('cyan_dye', 2, ['lapis_lazuli', 'green_dye']);
shapeless('purple_dye', 2, ['lapis_lazuli', 'red_dye']);
shapeless('magenta_dye', 2, ['purple_dye', 'pink_dye']);
shapeless('lime_dye', 2, ['green_dye', 'bone_meal']);
for (const [wool, dye] of [['orange', 'orange_dye'], ['magenta', 'magenta_dye'], ['light_blue', 'light_blue_dye'], ['lime', 'lime_dye'], ['pink', 'pink_dye'], ['gray', 'gray_dye'], ['light_gray', 'light_gray_dye'], ['cyan', 'cyan_dye'], ['purple', 'purple_dye'], ['blue', 'lapis_lazuli'], ['green', 'green_dye'], ['black', 'ink_sac']]) {
  shapeless(`wool_${wool}`, 1, [dye, 'wool_white']);
}
shapeless('gold_nugget', 9, ['gold_ingot']);
shaped('emerald_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'emerald' });
shapeless('emerald', 9, ['emerald_block']);
shapeless('lapis_lazuli', 9, ['lapis_block']);

export const SMELTING = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  oak_log: 'charcoal',
  birch_log: 'charcoal',
  spruce_log: 'charcoal',
  clay_ball: 'brick',
  porkchop: 'cooked_porkchop',
  beef: 'steak',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  coal_ore: 'coal',
  diamond_ore: 'diamond',
  nether_quartz_ore: 'quartz',
  lapis_ore: 'lapis_lazuli',
  cactus: 'green_dye',
  emerald_ore: 'emerald',
};

// Experience a furnace stores for each item it smelts, paid out when you take the result.
export const SMELT_XP = {
  iron_ore: 0.7, gold_ore: 1, diamond_ore: 1, coal_ore: 0.1, lapis_ore: 0.2, nether_quartz_ore: 0.2,
  sand: 0.1, cactus: 0.2, cobblestone: 0.1, clay_ball: 0.3, oak_log: 0.15, birch_log: 0.15, spruce_log: 0.15,
  porkchop: 0.35, beef: 0.35, chicken: 0.35, mutton: 0.35,
};

for (const r of RECIPES) {
  if (!ITEMS[r.result]) throw new Error(`Recipe makes unknown item ${r.result}`);
}

function accepts(ingredient, item) {
  if (!item) return false;
  if (ingredient.startsWith('#')) return TAGS[ingredient].includes(item);
  return ingredient === item;
}

// grid: array of w*h item names (or null). Returns { result, count } or null.
export function matchRecipe(grid, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const item = grid[y * w + x];
      if (!item) continue;
      items.push(item);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!items.length) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cell = (x, y) => grid[(minY + y) * w + minX + x];
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== bw || r.h !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) {
          for (let x = 0; x < bw && ok; x++) {
            const ch = (r.pattern[y][mirror ? bw - 1 - x : x] ?? ' ');
            const item = cell(x, y);
            if (ch === ' ') ok = !item;
            else ok = accepts(r.key[ch], item);
          }
        }
        if (ok) return { item: r.result, count: r.count };
      }
    } else if (r.ingredients.length === items.length) {
      const left = [...items];
      const ok = r.ingredients.every((ing) => {
        const i = left.findIndex((item) => accepts(ing, item));
        if (i < 0) return false;
        left.splice(i, 1);
        return true;
      });
      if (ok) return { item: r.result, count: r.count };
    }
  }
  return null;
}

// Every recipe that produces `item`, for the recipe hints in the inventory.
export function recipesFor(item) {
  return RECIPES.filter((r) => r.result === item);
}
