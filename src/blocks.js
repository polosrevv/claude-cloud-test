// Block registry. A block id is its index in DEFS and saved worlds store those
// ids, so new blocks are only ever appended. Blocks that point a direction,
// grow or flow get one id per state (furnace_n, wheat_3, water_5, ...).
import { textureIndex } from './textures.js';

export const RENDER = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, MODEL: 4 };

// Face order used everywhere: +x, -x, +y, -y, +z, -z.
export const FACE = { EAST: 0, WEST: 1, TOP: 2, BOTTOM: 3, SOUTH: 4, NORTH: 5 };

// Horizontal facings: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
export const FACINGS = ['n', 'e', 's', 'w'];
export const FACING_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const FACING_FACE = [FACE.NORTH, FACE.EAST, FACE.SOUTH, FACE.WEST];

const DEFS = [];
const def = (d) => {
  DEFS.push(d);
  return d;
};

const plant = { render: RENDER.CROSS, solid: false, opaque: false, plant: true, sound: 'grass', hardness: 0, replaceable: false };
const leaves = { opaque: false, cutout: true, leaves: true, atten: 1, sound: 'grass', hardness: 0.2, tool: 'shears', drops: 'leaves' };
const log = (name) => ({ top: `${name}_top`, bottom: `${name}_top`, side: name });
const stoneLike = (extra) => ({ sound: 'stone', tool: 'pickaxe', tier: 0, ...extra });

// ---- original blocks (ids 0-41, keep this order) ----
def({ key: 'air', name: 'Air', render: RENDER.NONE, solid: false, opaque: false, hidden: true, replaceable: true, hardness: 0 });
def({ key: 'grass', name: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, sound: 'grass', hardness: 0.6, tool: 'shovel', drops: 'dirt' });
def({ key: 'dirt', name: 'Dirt', tex: 'dirt', sound: 'grass', hardness: 0.5, tool: 'shovel' });
def({ key: 'stone', name: 'Stone', tex: 'stone', ...stoneLike({ hardness: 1.5, drops: 'cobblestone', resistance: 6 }) });
def({ key: 'cobblestone', name: 'Cobblestone', tex: 'cobblestone', ...stoneLike({ hardness: 2, resistance: 6 }) });
def({ key: 'sand', name: 'Sand', tex: 'sand', sound: 'sand', falls: true, hardness: 0.5, tool: 'shovel' });
def({ key: 'gravel', name: 'Gravel', tex: 'gravel', sound: 'gravel', falls: true, hardness: 0.6, tool: 'shovel', drops: 'gravel' });
def({ key: 'bedrock', name: 'Bedrock', tex: 'bedrock', sound: 'stone', hardness: -1, resistance: 3600000 });
def({ key: 'water', name: 'Water', tex: 'water', render: RENDER.LIQUID, solid: false, opaque: false, atten: 2, sound: 'water', fluid: 'water', level: 0, hardness: -1, resistance: 100, replaceable: true, translucent: true, item: null });
def({ key: 'oak_log', name: 'Oak Log', tex: log('oak_log'), sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'oak_leaves', name: 'Oak Leaves', tex: 'oak_leaves', ...leaves });
def({ key: 'birch_log', name: 'Birch Log', tex: log('birch_log'), sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'birch_leaves', name: 'Birch Leaves', tex: 'birch_leaves', ...leaves });
def({ key: 'spruce_log', name: 'Spruce Log', tex: log('spruce_log'), sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'spruce_leaves', name: 'Spruce Leaves', tex: 'spruce_leaves', ...leaves });
def({ key: 'planks', name: 'Oak Planks', tex: 'planks', sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'glass', name: 'Glass', tex: 'glass', opaque: false, cutout: true, selfCull: true, sound: 'glass', hardness: 0.3, drops: null });
def({ key: 'bricks', name: 'Bricks', tex: 'bricks', ...stoneLike({ hardness: 2, resistance: 6 }) });
def({ key: 'snow', name: 'Snow', tex: 'snow', sound: 'snow', hardness: 0.2, tool: 'shovel', harvest: 'shovel' });
def({ key: 'snowy_grass', name: 'Snowy Grass', tex: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, sound: 'snow', hardness: 0.6, tool: 'shovel', drops: 'dirt' });
def({ key: 'sandstone', name: 'Sandstone', tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' }, ...stoneLike({ hardness: 0.8 }) });
def({ key: 'cactus', name: 'Cactus', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus' }, opaque: false, cutout: true, inset: true, sound: 'cloth', hardness: 0.4, collision: [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]], hurts: 1 });
def({ key: 'coal_ore', name: 'Coal Ore', tex: 'coal_ore', ...stoneLike({ hardness: 3, drops: 'coal' }) });
def({ key: 'iron_ore', name: 'Iron Ore', tex: 'iron_ore', ...stoneLike({ hardness: 3, tier: 1 }) });
def({ key: 'gold_ore', name: 'Gold Ore', tex: 'gold_ore', ...stoneLike({ hardness: 3, tier: 2 }) });
def({ key: 'diamond_ore', name: 'Diamond Ore', tex: 'diamond_ore', ...stoneLike({ hardness: 3, tier: 2, drops: 'diamond' }) });
def({ key: 'glowstone', name: 'Glowstone', tex: 'glowstone', emit: 15, sound: 'glass', hardness: 0.3, drops: { item: 'glowstone_dust', min: 2, max: 4 } });
def({ key: 'tall_grass', name: 'Tall Grass', tex: 'tall_grass', ...plant, replaceable: true, drops: { item: 'wheat_seeds', chance: 0.125 } });
def({ key: 'poppy', name: 'Poppy', tex: 'poppy', ...plant });
def({ key: 'dandelion', name: 'Dandelion', tex: 'dandelion', ...plant });
def({ key: 'dead_bush', name: 'Dead Bush', tex: 'dead_bush', ...plant, onSand: true, replaceable: true, drops: { item: 'stick', min: 0, max: 2 } });
def({ key: 'stone_bricks', name: 'Stone Bricks', tex: 'stone_bricks', ...stoneLike({ hardness: 1.5, resistance: 6 }) });
def({ key: 'bookshelf', name: 'Bookshelf', tex: { top: 'planks', bottom: 'planks', side: 'bookshelf' }, sound: 'wood', hardness: 1.5, tool: 'axe', drops: { item: 'book', min: 3, max: 3 } });
def({ key: 'crafting_table', name: 'Crafting Table', tex: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' }, sound: 'wood', hardness: 2.5, tool: 'axe', use: 'crafting' });
def({ key: 'mossy_cobblestone', name: 'Mossy Cobblestone', tex: 'mossy_cobblestone', ...stoneLike({ hardness: 2, resistance: 6 }) });
def({ key: 'obsidian', name: 'Obsidian', tex: 'obsidian', ...stoneLike({ hardness: 50, tier: 3, resistance: 1200 }) });
for (const [color, name] of [['white', 'White'], ['red', 'Red'], ['yellow', 'Yellow'], ['lime', 'Lime'], ['blue', 'Blue'], ['black', 'Black']]) {
  def({ key: `wool_${color}`, name: `${name} Wool`, tex: `wool_${color}`, sound: 'cloth', hardness: 0.8, tool: 'shears' });
}

// ---- added for survival (ids 42+) ----
for (let level = 1; level <= 8; level++) {
  def({ key: `water_${level}`, name: 'Water', tex: 'water', render: RENDER.LIQUID, solid: false, opaque: false, atten: 2, sound: 'water', fluid: 'water', level, hardness: -1, resistance: 100, replaceable: true, translucent: true, hidden: true, item: null });
}
def({ key: 'lava', name: 'Lava', tex: 'lava', render: RENDER.LIQUID, solid: false, opaque: false, emit: 15, sound: 'water', fluid: 'lava', level: 0, hardness: -1, resistance: 100, replaceable: true, item: null, hurts: 4, hidden: true });
for (let level = 1; level <= 8; level++) {
  def({ key: `lava_${level}`, name: 'Lava', tex: 'lava', render: RENDER.LIQUID, solid: false, opaque: false, emit: 15, sound: 'water', fluid: 'lava', level, hardness: -1, resistance: 100, replaceable: true, hidden: true, item: null, hurts: 4 });
}
def({ key: 'birch_planks', name: 'Birch Planks', tex: 'birch_planks', sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'spruce_planks', name: 'Spruce Planks', tex: 'spruce_planks', sound: 'wood', hardness: 2, tool: 'axe', flammable: true });

const TORCH_BOX = { from: [7, 0, 7], to: [9, 10, 9], uv: { 2: [7, 6, 9, 8], 3: [7, 14, 9, 16] } };
def({ key: 'torch', name: 'Torch', tex: 'torch', render: RENDER.MODEL, model: [TORCH_BOX], solid: false, opaque: false, emit: 14, sound: 'wood', hardness: 0, collision: null, select: [[6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16]], needsSupport: 'below' });
// Wall torches lean away from the wall they hang on; the name says which way they point.
for (let f = 0; f < 4; f++) {
  def({
    key: `wall_torch_${FACINGS[f]}`, name: 'Torch', tex: 'torch', render: RENDER.MODEL, facing: f, item: 'torch', hidden: true,
    model: [{ from: [7, 3, 14], to: [9, 13, 16], shear: [0, -5], uv: TORCH_BOX.uv }],
    solid: false, opaque: false, emit: 14, sound: 'wood', hardness: 0, collision: null, needsSupport: 'behind',
  });
}
for (const lit of [false, true]) {
  for (let f = 0; f < 4; f++) {
    def({
      key: `furnace${lit ? '_lit' : ''}_${FACINGS[f]}`, name: 'Furnace', facing: f, item: 'furnace', hidden: f > 0 || lit,
      tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: lit ? 'furnace_front_lit' : 'furnace_front' },
      emit: lit ? 13 : 0, ...stoneLike({ hardness: 3.5 }), use: 'furnace', entity: 'furnace',
    });
  }
}
for (let f = 0; f < 4; f++) {
  def({
    key: `chest_${FACINGS[f]}`, name: 'Chest', facing: f, item: 'chest', hidden: f > 0, render: RENDER.MODEL,
    tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' },
    model: [{ from: [1, 0, 1], to: [15, 14, 15] }], opaque: false, sound: 'wood', hardness: 2.5, tool: 'axe', use: 'chest', entity: 'chest',
  });
}
// Beds: the facing is the direction from the foot to the head.
for (const part of ['foot', 'head']) {
  for (let f = 0; f < 4; f++) {
    def({
      key: `bed_${part}_${FACINGS[f]}`, name: 'Bed', facing: f, item: 'bed', hidden: true, render: RENDER.MODEL,
      tex: { top: `bed_${part}_top`, bottom: 'planks', side: 'bed_side' },
      model: [{ from: [0, 0, 0], to: [16, 9, 16] }], opaque: false, sound: 'cloth', hardness: 0.2, use: 'bed', bed: part,
    });
  }
}
// Doors: one id per half, facing and open state. A closed door sits on the
// side of its cell nearest whoever placed it; an open one swings to the hinge side.
for (const half of ['lower', 'upper']) {
  for (const open of [false, true]) {
    for (let f = 0; f < 4; f++) {
      def({
        key: `oak_door_${half}_${FACINGS[f]}${open ? '_open' : ''}`, name: 'Oak Door', facing: f, item: 'oak_door', hidden: true,
        render: RENDER.MODEL, tex: half === 'lower' ? 'door_lower' : 'door_upper', cutout: true,
        model: [open ? { from: [13, 0, 0], to: [16, 16, 16] } : { from: [0, 0, 13], to: [16, 16, 16] }],
        opaque: false, sound: 'wood', hardness: 3, tool: 'axe', use: 'door', door: { half, open },
      });
    }
  }
}
def({ key: 'farmland', name: 'Farmland', tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, render: RENDER.MODEL, model: [{ from: [0, 0, 0], to: [16, 15, 16], uv: { 0: [0, 1, 16, 16], 1: [0, 1, 16, 16], 4: [0, 1, 16, 16], 5: [0, 1, 16, 16] } }], opaque: false, sound: 'grass', hardness: 0.6, tool: 'shovel', drops: 'dirt' });
for (let stage = 0; stage < 8; stage++) {
  def({
    key: `wheat_${stage}`, name: 'Wheat', tex: `wheat_${stage}`, ...plant, hidden: true, item: 'wheat_seeds', crop: stage, onFarmland: true,
    drops: stage === 7 ? [{ item: 'wheat', min: 1, max: 1 }, { item: 'wheat_seeds', min: 0, max: 3 }] : 'wheat_seeds',
  });
}
for (const [kind, name] of [['oak', 'Oak'], ['birch', 'Birch'], ['spruce', 'Spruce']]) {
  def({ key: `${kind}_sapling`, name: `${name} Sapling`, tex: `${kind}_sapling`, ...plant, sapling: kind });
}
def({ key: 'sugar_cane', name: 'Sugar Cane', tex: 'sugar_cane', ...plant, cane: true, hidden: true });
def({ key: 'clay', name: 'Clay', tex: 'clay', sound: 'gravel', hardness: 0.6, tool: 'shovel', drops: { item: 'clay_ball', min: 4, max: 4 } });
def({ key: 'iron_block', name: 'Block of Iron', tex: 'iron_block', ...stoneLike({ hardness: 5, tier: 1, resistance: 6 }) });
def({ key: 'gold_block', name: 'Block of Gold', tex: 'gold_block', ...stoneLike({ hardness: 3, tier: 2, resistance: 6 }) });
def({ key: 'diamond_block', name: 'Block of Diamond', tex: 'diamond_block', ...stoneLike({ hardness: 5, tier: 2, resistance: 6 }) });
def({ key: 'tnt', name: 'TNT', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, sound: 'grass', hardness: 0, resistance: 0, use: 'tnt' });
def({ key: 'fire', name: 'Fire', tex: 'fire', render: RENDER.CROSS, solid: false, opaque: false, emit: 15, sound: 'cloth', hardness: 0, drops: null, replaceable: true, hidden: true, hurts: 1, select: [[0, 0, 0, 1, 1 / 16, 1]] });
def({ key: 'netherrack', name: 'Netherrack', tex: 'netherrack', ...stoneLike({ hardness: 0.4 }) });
def({ key: 'soul_sand', name: 'Soul Sand', tex: 'soul_sand', sound: 'sand', hardness: 0.5, tool: 'shovel', collision: [[0, 0, 0, 1, 14 / 16, 1]], slows: true });
def({ key: 'nether_quartz_ore', name: 'Nether Quartz Ore', tex: 'nether_quartz_ore', ...stoneLike({ hardness: 3, drops: 'quartz' }) });
def({ key: 'nether_bricks', name: 'Nether Bricks', tex: 'nether_bricks', ...stoneLike({ hardness: 2, resistance: 6 }) });
for (const axis of ['x', 'z']) {
  def({
    key: `nether_portal_${axis}`, name: 'Nether Portal', tex: 'nether_portal', render: RENDER.MODEL, hidden: true, item: null,
    model: [axis === 'x' ? { from: [0, 0, 6], to: [16, 16, 10] } : { from: [6, 0, 0], to: [10, 16, 16] }],
    solid: false, opaque: false, translucent: true, emit: 11, hardness: -1, drops: null, collision: null, select: [], portal: 'nether', sound: 'glass', scroll: true,
  });
}
def({ key: 'end_stone', name: 'End Stone', tex: 'end_stone', ...stoneLike({ hardness: 3, resistance: 9 }) });
const FRAME = { from: [0, 0, 0], to: [16, 13, 16], uv: { 0: [0, 3, 16, 16], 1: [0, 3, 16, 16], 4: [0, 3, 16, 16], 5: [0, 3, 16, 16] } };
const FRAME_TEX = { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side' };
def({ key: 'end_portal_frame', name: 'End Portal Frame', tex: FRAME_TEX, render: RENDER.MODEL, model: [FRAME], opaque: false, sound: 'stone', hardness: -1, resistance: 3600000, emit: 1, use: 'frame' });
def({ key: 'end_portal_frame_eye', name: 'End Portal Frame', tex: FRAME_TEX, render: RENDER.MODEL, model: [FRAME, { from: [4, 13, 4], to: [12, 16, 12], tex: 'end_portal_eye' }], opaque: false, sound: 'stone', hardness: -1, resistance: 3600000, emit: 1, hidden: true, item: 'end_portal_frame', collision: [[0, 0, 0, 1, 1, 1]] });
def({ key: 'end_portal', name: 'End Portal', tex: 'end_portal', render: RENDER.MODEL, model: [{ from: [0, 0, 0], to: [16, 12, 16] }], solid: false, opaque: false, emit: 15, hardness: -1, resistance: 3600000, drops: null, hidden: true, item: null, collision: null, select: [], portal: 'end', sound: 'glass', scroll: true });
const EGG = [[6, 15, 10], [5, 14, 11], [4, 13, 12], [3, 11, 13], [2, 8, 14], [1, 3, 15], [2, 1, 14], [3, 0, 13]];
def({
  key: 'dragon_egg', name: 'Dragon Egg', tex: 'dragon_egg', render: RENDER.MODEL, falls: true,
  model: EGG.map(([a, y, b], i) => ({ from: [a, y, a], to: [b, i === 0 ? 16 : EGG[i - 1][1], b] })),
  opaque: false, sound: 'stone', hardness: 3, emit: 1, collision: [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]],
});
def({ key: 'spawner', name: 'Monster Spawner', tex: 'spawner', opaque: false, cutout: true, ...stoneLike({ hardness: 5, drops: null }), entity: 'spawner' });
def({ key: 'stone_slab', name: 'Stone Slab', tex: { top: 'stone_slab_top', bottom: 'stone_slab_top', side: 'stone_slab_side' }, render: RENDER.MODEL, model: [{ from: [0, 0, 0], to: [16, 8, 16] }], opaque: false, ...stoneLike({ hardness: 2, resistance: 6 }) });
def({ key: 'oak_slab', name: 'Oak Slab', tex: 'planks', render: RENDER.MODEL, model: [{ from: [0, 0, 0], to: [16, 8, 16] }], opaque: false, sound: 'wood', hardness: 2, tool: 'axe' });
for (let f = 0; f < 4; f++) {
  def({
    key: `ladder_${FACINGS[f]}`, name: 'Ladder', tex: 'ladder', facing: f, item: 'ladder', hidden: f > 0, render: RENDER.MODEL, cutout: true,
    model: [{ from: [0, 0, 15], to: [16, 16, 16] }], opaque: false, sound: 'wood', hardness: 0.4, tool: 'axe', climbable: true, needsSupport: 'behind',
  });
}
def({ key: 'ice', name: 'Ice', tex: 'ice', opaque: false, translucent: true, selfCull: true, sound: 'glass', hardness: 0.5, tool: 'pickaxe', drops: null, slippery: true });
// ---- Enchanting (new blocks always go at the end so saved ids stay valid) ----
def({ key: 'lapis_ore', name: 'Lapis Lazuli Ore', tex: 'lapis_ore', ...stoneLike({ hardness: 3, tier: 1, drops: { item: 'lapis_lazuli', min: 4, max: 8 } }) });
def({ key: 'lapis_block', name: 'Lapis Lazuli Block', tex: 'lapis_block', ...stoneLike({ hardness: 3, tier: 1 }) });
const TABLE_SIDE = [0, 4, 16, 16];
def({
  key: 'enchanting_table', name: 'Enchanting Table', tex: { top: 'enchanting_table_top', bottom: 'obsidian', side: 'enchanting_table_side' },
  render: RENDER.MODEL,
  model: [
    { from: [0, 0, 0], to: [16, 12, 16], uv: { 0: TABLE_SIDE, 1: TABLE_SIDE, 4: TABLE_SIDE, 5: TABLE_SIDE } },
    { from: [4, 13, 5], to: [12, 15, 11], tex: 'enchanting_book' },
  ],
  collision: [[0, 0, 0, 1, 0.75, 1]],
  opaque: false, emit: 7, ...stoneLike({ hardness: 5, resistance: 1200 }), use: 'enchant',
});

// ---- Building blocks and food ----
// Stairs: a bottom slab plus a back half, rising toward the facing direction.
const STAIRS = [
  ['oak', 'Oak', 'planks', { sound: 'wood', hardness: 2, tool: 'axe', flammable: true }],
  ['cobblestone', 'Cobblestone', 'cobblestone', stoneLike({ hardness: 2, resistance: 6 })],
  ['stone_brick', 'Stone Brick', 'stone_bricks', stoneLike({ hardness: 1.5, resistance: 6 })],
  ['brick', 'Brick', 'bricks', stoneLike({ hardness: 2, resistance: 6 })],
  ['sandstone', 'Sandstone', { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' }, stoneLike({ hardness: 0.8 })],
];
for (const [mat, name, tex, props] of STAIRS) {
  for (let f = 0; f < 4; f++) {
    def({
      key: `${mat}_stairs_${FACINGS[f]}`, name: `${name} Stairs`, tex, facing: f, item: `${mat}_stairs`, hidden: true, render: RENDER.MODEL,
      model: [{ from: [0, 0, 0], to: [16, 8, 16] }, { from: [0, 8, 0], to: [16, 16, 8] }], opaque: false, ...props,
    });
  }
}
// Fences and panes join up with their neighbours (see CONNECT below).
def({ key: 'oak_fence', name: 'Oak Fence', tex: 'planks', render: RENDER.MODEL, model: [{ from: [6, 0, 6], to: [10, 16, 10] }], opaque: false, connect: 'fence', sound: 'wood', hardness: 2, tool: 'axe', flammable: true });
def({ key: 'nether_brick_fence', name: 'Nether Brick Fence', tex: 'nether_bricks', render: RENDER.MODEL, model: [{ from: [6, 0, 6], to: [10, 16, 10] }], opaque: false, connect: 'fence', ...stoneLike({ hardness: 2, resistance: 6 }) });
def({ key: 'glass_pane', name: 'Glass Pane', tex: 'glass', render: RENDER.MODEL, model: [{ from: [7, 0, 7], to: [9, 16, 9] }], opaque: false, cutout: true, connect: 'pane', sound: 'glass', hardness: 0.3, drops: null });
def({ key: 'iron_bars', name: 'Iron Bars', tex: 'iron_bars', render: RENDER.MODEL, model: [{ from: [7, 0, 7], to: [9, 16, 9] }], opaque: false, cutout: true, connect: 'pane', ...stoneLike({ hardness: 5, resistance: 6 }) });
// Fence gates: closed they block like a fence; open they swing aside.
for (const open of [false, true]) {
  for (let f = 0; f < 4; f++) {
    const rails = open
      ? [{ from: [0, 6, 0], to: [2, 9, 7] }, { from: [0, 12, 0], to: [2, 15, 7] }, { from: [14, 6, 0], to: [16, 9, 7] }, { from: [14, 12, 0], to: [16, 15, 7] }]
      : [{ from: [2, 6, 7], to: [14, 9, 9] }, { from: [2, 12, 7], to: [14, 15, 9] }, { from: [6, 9, 7], to: [10, 12, 9] }];
    const along = f % 2 === 0;
    def({
      key: `oak_fence_gate_${FACINGS[f]}${open ? '_open' : ''}`, name: 'Oak Fence Gate', tex: 'planks', facing: f, item: 'oak_fence_gate', hidden: true,
      render: RENDER.MODEL, model: [{ from: [0, 5, 7], to: [2, 16, 9] }, { from: [14, 5, 7], to: [16, 16, 9] }, ...rails],
      collision: open ? null : [along ? [0, 0, 6 / 16, 1, 1.5, 10 / 16] : [6 / 16, 0, 0, 10 / 16, 1.5, 1]],
      select: [along ? [0, 0, 6 / 16, 1, 1, 10 / 16] : [6 / 16, 0, 0, 10 / 16, 1, 1]],
      opaque: false, gate: { open }, use: 'gate', sound: 'wood', hardness: 2, tool: 'axe', flammable: true,
    });
  }
}
for (const [color, name] of [['orange', 'Orange'], ['magenta', 'Magenta'], ['light_blue', 'Light Blue'], ['pink', 'Pink'], ['gray', 'Gray'], ['light_gray', 'Light Gray'], ['cyan', 'Cyan'], ['purple', 'Purple'], ['green', 'Green'], ['brown', 'Brown']]) {
  def({ key: `wool_${color}`, name: `${name} Wool`, tex: `wool_${color}`, sound: 'cloth', hardness: 0.8, tool: 'shears', flammable: true });
}
for (const lit of [false, true]) {
  for (let f = 0; f < 4; f++) {
    def({
      key: `${lit ? 'jack_o_lantern' : 'pumpkin'}_${FACINGS[f]}`, name: lit ? "Jack o'Lantern" : 'Pumpkin', facing: f, item: lit ? 'jack_o_lantern' : 'pumpkin', hidden: true,
      tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: lit ? 'jack_o_lantern_face' : 'pumpkin_face' },
      emit: lit ? 15 : 0, sound: 'wood', hardness: 1, tool: 'axe',
    });
  }
}
def({ key: 'melon', name: 'Melon', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, sound: 'wood', hardness: 1, tool: 'axe', drops: { item: 'melon_slice', min: 3, max: 7 } });
// Stems grow through eight stages, then put a fruit on a free block beside them.
for (const fruit of ['pumpkin', 'melon']) {
  for (let stage = 0; stage < 8; stage++) {
    def({ key: `${fruit}_stem_${stage}`, name: `${fruit === 'pumpkin' ? 'Pumpkin' : 'Melon'} Stem`, tex: `stem_${stage}`, ...plant, hidden: true, item: `${fruit}_seeds`, stem: fruit, stage, onFarmland: true, drops: `${fruit}_seeds` });
  }
}
def({ key: 'brown_mushroom', name: 'Brown Mushroom', tex: 'brown_mushroom', ...plant, mushroom: true, emit: 1 });
def({ key: 'red_mushroom', name: 'Red Mushroom', tex: 'red_mushroom', ...plant, mushroom: true });
// Cake: seven slices, eaten one right-click at a time.
for (let bites = 0; bites < 7; bites++) {
  const x0 = 1 + bites * 2;
  def({
    key: `cake_${bites}`, name: 'Cake', tex: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side' }, hidden: true, item: bites === 0 ? 'cake' : null,
    render: RENDER.MODEL, model: [{ from: [x0, 0, 1], to: [15, 8, 15], uv: bites ? { 1: [1, 8, 15, 16] } : undefined, ...(bites ? { faceTex: { 1: 'cake_inner' } } : {}) }],
    opaque: false, cake: bites, use: 'cake', sound: 'cloth', hardness: 0.5, drops: null, needsSupport: 'below',
  });
}

export const BLOCK_COUNT = DEFS.length;
if (BLOCK_COUNT > 256) throw new Error('Too many block states for a byte');

// B.GRASS, B.OAK_LOG, ... -> numeric id
export const B = {};
DEFS.forEach((d, id) => { B[d.key.toUpperCase()] = id; });

// Flat lookup tables: the mesher and physics read these in tight loops.
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
export const RENDER_TYPE = new Uint8Array(256);
export const SELF_CULL = new Uint8Array(256);
export const LEAVES = new Uint8Array(256);
export const INSET = new Uint8Array(256);
export const PLANT = new Uint8Array(256);
export const FALLS = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const ATTEN = new Uint8Array(256);
export const TRANSLUCENT = new Uint8Array(256);
export const FLUID = new Uint8Array(256); // 0 none, 1 water, 2 lava
export const FLUID_LEVEL = new Uint8Array(256); // 0 source, 1-7 spreading, 8 falling
export const REPLACEABLE = new Uint8Array(256);
export const CLIMBABLE = new Uint8Array(256);
export const SCROLL = new Uint8Array(256);
export const FACE_TEX = new Uint16Array(256 * 6);
// Collision and selection shapes in block units: null = none, otherwise a list of [x0, y0, z0, x1, y1, z1].
export const COLLISION = new Array(256).fill(null);
export const SELECTION = new Array(256).fill(null);
// Processed render boxes for RENDER.MODEL blocks.
export const MODELS = new Array(256).fill(null);

const FULL = [[0, 0, 0, 1, 1, 1]];

// Rotate a north-facing model a quarter turn clockwise (seen from above) `turns` times.
const TURN_FACE = { 5: 0, 0: 4, 4: 1, 1: 5, 2: 2, 3: 3 };
function rotateBox(box, turns) {
  let [x0, y0, z0] = box.from;
  let [x1, y1, z1] = box.to;
  let shear = box.shear ? [...box.shear] : null;
  let faceTex = { ...(box.faceTex || {}) };
  let uv = { ...(box.uv || {}) };
  const remap = (obj) => {
    const out = {};
    for (const k of Object.keys(obj)) out[TURN_FACE[k]] = obj[k];
    return out;
  };
  for (let t = 0; t < turns; t++) {
    [x0, z0, x1, z1] = [16 - z1, x0, 16 - z0, x1];
    if (shear) shear = [-shear[1], shear[0]];
    faceTex = remap(faceTex);
    uv = remap(uv);
  }
  return { from: [x0, y0, z0], to: [x1, y1, z1], shear, faceTex, uv, rot: turns };
}

DEFS.forEach((d, id) => {
  const render = d.render ?? RENDER.CUBE;
  RENDER_TYPE[id] = render;
  OPAQUE[id] = (d.opaque ?? true) ? 1 : 0;
  SOLID[id] = (d.solid ?? true) ? 1 : 0;
  SELF_CULL[id] = d.selfCull ? 1 : 0;
  LEAVES[id] = d.leaves ? 1 : 0;
  INSET[id] = d.inset ? 1 : 0;
  PLANT[id] = d.plant ? 1 : 0;
  FALLS[id] = d.falls ? 1 : 0;
  EMIT[id] = d.emit ?? 0;
  ATTEN[id] = d.atten ?? 0;
  TRANSLUCENT[id] = d.translucent ? 1 : 0;
  FLUID[id] = d.fluid === 'water' ? 1 : d.fluid === 'lava' ? 2 : 0;
  FLUID_LEVEL[id] = d.level ?? 0;
  REPLACEABLE[id] = (d.replaceable ?? false) ? 1 : 0;
  CLIMBABLE[id] = d.climbable ? 1 : 0;
  SCROLL[id] = d.scroll || d.fluid ? 1 : 0;

  // Shapes
  if (d.collision !== undefined) COLLISION[id] = d.collision;
  else if (!SOLID[id]) COLLISION[id] = null;
  else if (render === RENDER.MODEL) COLLISION[id] = null; // filled from the model below
  else COLLISION[id] = FULL;

  if (render === RENDER.NONE) return;
  const tex = typeof d.tex === 'string' ? { top: d.tex, bottom: d.tex, side: d.tex } : d.tex;
  const faces = [tex.side, tex.side, tex.top, tex.bottom, tex.side, tex.side];
  if (tex.front && d.facing !== undefined) faces[FACING_FACE[d.facing]] = tex.front;
  faces.forEach((name, f) => { FACE_TEX[id * 6 + f] = textureIndex(name); });

  if (render === RENDER.MODEL) {
    const turns = d.facing ?? 0;
    const boxes = d.model.map((b) => {
      const faceTex = { ...(b.faceTex || {}) };
      if (b.tex) for (let f = 0; f < 6; f++) faceTex[f] = b.tex;
      // A front texture follows the model's north face.
      if (tex.front) faceTex[FACE.NORTH] = tex.front;
      return rotateBox({ ...b, faceTex }, turns);
    });
    MODELS[id] = boxes.map((b) => ({
      from: b.from,
      to: b.to,
      shear: b.shear,
      uv: b.uv,
      rot: b.rot,
      layers: [0, 1, 2, 3, 4, 5].map((f) => (b.faceTex[f] ? textureIndex(b.faceTex[f]) : FACE_TEX[id * 6 + f])),
    }));
    const asUnits = MODELS[id].map((b) => [
      Math.min(b.from[0], b.to[0]) / 16, b.from[1] / 16, Math.min(b.from[2], b.to[2]) / 16,
      Math.max(b.from[0], b.to[0]) / 16, b.to[1] / 16, Math.max(b.from[2], b.to[2]) / 16,
    ]);
    if (d.collision === undefined && (d.solid ?? true)) COLLISION[id] = asUnits;
    SELECTION[id] = d.select ?? asUnits;
  }
  if (!SELECTION[id]) {
    if (d.select) SELECTION[id] = d.select;
    else if (FLUID[id]) SELECTION[id] = null;
    else if (render === RENDER.CROSS) SELECTION[id] = [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
    else SELECTION[id] = COLLISION[id] ?? FULL;
  }
  SOLID[id] = COLLISION[id] ? 1 : 0;
});

// ---- Connecting blocks: fences and panes reach out to their neighbours ----
// Mask bits: 1 north (-z), 2 east (+x), 4 south (+z), 8 west (-x).
export const CONNECT = new Uint8Array(256); // 0 none, 1 fence, 2 pane
const GATE = new Uint8Array(256);
const CONNECT_MODELS = new Array(256).fill(null);
const CONNECT_SHAPES = new Array(256).fill(null);
const CONNECT_SELECT = new Array(256).fill(null);
const ARMS = {
  fence: {
    post: [[6, 0, 6, 10, 16, 10]],
    1: [[7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]], 2: [[10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]],
    4: [[7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]], 8: [[0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]],
    hit: { post: [6, 0, 6, 10, 24, 10], 1: [6, 0, 0, 10, 24, 6], 2: [10, 0, 6, 16, 24, 10], 4: [6, 0, 10, 10, 24, 16], 8: [0, 0, 6, 6, 24, 10] },
  },
  pane: {
    post: [[7, 0, 7, 9, 16, 9]],
    1: [[7, 0, 0, 9, 16, 7]], 2: [[9, 0, 7, 16, 16, 9]], 4: [[7, 0, 9, 9, 16, 16]], 8: [[0, 0, 7, 7, 16, 9]],
    hit: { post: [7, 0, 7, 9, 16, 9], 1: [7, 0, 0, 9, 16, 7], 2: [9, 0, 7, 16, 16, 9], 4: [7, 0, 9, 9, 16, 16], 8: [0, 0, 7, 7, 16, 9] },
  },
};
DEFS.forEach((d, id) => {
  if (d.gate) GATE[id] = 1;
  if (!d.connect) return;
  CONNECT[id] = d.connect === 'fence' ? 1 : 2;
  const arms = ARMS[d.connect];
  const layers = [0, 1, 2, 3, 4, 5].map((f) => FACE_TEX[id * 6 + f]);
  const units = (b) => b.map((v, k) => (k === 1 || k === 4 ? v / 16 : v / 16));
  CONNECT_MODELS[id] = [];
  CONNECT_SHAPES[id] = [];
  CONNECT_SELECT[id] = [];
  for (let mask = 0; mask < 16; mask++) {
    const parts = [...arms.post];
    const hits = [arms.hit.post];
    for (const bit of [1, 2, 4, 8]) {
      if (mask & bit) {
        parts.push(...arms[bit]);
        hits.push(arms.hit[bit]);
      }
    }
    CONNECT_MODELS[id].push(parts.map((b) => ({ from: [b[0], b[1], b[2]], to: [b[3], b[4], b[5]], layers })));
    CONNECT_SHAPES[id].push(hits.map(units));
    CONNECT_SELECT[id].push(hits.map((b) => units([b[0], b[1], b[2], b[3], Math.min(16, b[4]), b[5]])));
  }
});

// Does a connecting block reach toward this neighbour?
export function connectsTo(id, other) {
  const g = CONNECT[id];
  if (!g || !other) return false;
  if (CONNECT[other] === g) return true;
  if (g === 1 && GATE[other]) return true;
  return OPAQUE[other] === 1 && RENDER_TYPE[other] === RENDER.CUBE;
}

// Neighbour mask for a connecting block; get(dx, dz) returns the neighbour's id.
export function connectMask(id, get) {
  let mask = 0;
  if (connectsTo(id, get(0, -1))) mask |= 1;
  if (connectsTo(id, get(1, 0))) mask |= 2;
  if (connectsTo(id, get(0, 1))) mask |= 4;
  if (connectsTo(id, get(-1, 0))) mask |= 8;
  return mask;
}

export const connectModel = (id, mask) => CONNECT_MODELS[id][mask];
export const connectShapes = (id, mask) => CONNECT_SHAPES[id][mask];
export const connectSelection = (id, mask) => CONNECT_SELECT[id][mask];

export const BLOCKS = DEFS.map((d, id) => ({
  ...d,
  id,
  sound: d.sound ?? 'stone',
  hidden: !!d.hidden,
  hardness: d.hardness ?? 1,
  resistance: d.resistance ?? Math.max(0.2, (d.hardness ?? 1) * 3),
  // The item this block gives back and is placed from (null = none).
  item: d.item === undefined ? d.key : d.item,
}));

export function blockId(key) {
  const id = B[key.toUpperCase()];
  if (id === undefined) throw new Error(`Unknown block "${key}"`);
  return id;
}

export function fluidBlock(type, level) {
  const name = type === 1 ? 'water' : 'lava';
  return level === 0 ? B[name.toUpperCase()] : B[`${name}_${level}`.toUpperCase()];
}

// Blocks a plant can sit on.
export function canSupportPlant(plantId, groundId) {
  const p = BLOCKS[plantId];
  if (p.onSand) return groundId === B.SAND;
  if (p.mushroom) return OPAQUE[groundId] === 1 && SOLID[groundId] === 1;
  if (p.onFarmland) return groundId === B.FARMLAND;
  if (p.cane) return groundId === B.SUGAR_CANE || groundId === B.GRASS || groundId === B.DIRT || groundId === B.SAND;
  return groundId === B.GRASS || groundId === B.DIRT || groundId === B.SNOWY_GRASS || groundId === B.FARMLAND;
}

// Air, fluids, fire and tall grass can be built into without breaking them first.
export function isReplaceable(id) {
  return REPLACEABLE[id] === 1;
}

export function facingBlock(prefix, facing) {
  return B[`${prefix}_${FACINGS[facing]}`.toUpperCase()];
}

// Facing that points back at a player looking along yaw (so a furnace front faces them).
export function facingTowardViewer(yaw) {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz > 0 ? 0 : 2;
}

export function facingOfLook(yaw) {
  return (facingTowardViewer(yaw) + 2) % 4;
}
