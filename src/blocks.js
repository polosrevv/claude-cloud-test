// Block registry. A block's id is its index in DEFS, and saved worlds store
// those ids, so only ever append new blocks to the end of the list.
import { textureIndex } from './textures.js';

export const RENDER = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3 };

// Face order used everywhere: +x, -x, +y, -y, +z, -z.
export const FACE = { EAST: 0, WEST: 1, TOP: 2, BOTTOM: 3, SOUTH: 4, NORTH: 5 };

const plant = { render: RENDER.CROSS, solid: false, opaque: false, plant: true, sound: 'grass' };
const leaves = { opaque: false, cutout: true, leaves: true, atten: 1, sound: 'grass' };
const log = (name) => ({ top: `${name}_top`, bottom: `${name}_top`, side: name });

const DEFS = [
  { key: 'air', name: 'Air', render: RENDER.NONE, solid: false, opaque: false, hidden: true },
  { key: 'grass', name: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, sound: 'grass' },
  { key: 'dirt', name: 'Dirt', tex: 'dirt', sound: 'grass' },
  { key: 'stone', name: 'Stone', tex: 'stone', sound: 'stone' },
  { key: 'cobblestone', name: 'Cobblestone', tex: 'cobblestone', sound: 'stone' },
  { key: 'sand', name: 'Sand', tex: 'sand', sound: 'sand', falls: true },
  { key: 'gravel', name: 'Gravel', tex: 'gravel', sound: 'gravel', falls: true },
  { key: 'bedrock', name: 'Bedrock', tex: 'bedrock', sound: 'stone' },
  { key: 'water', name: 'Water', tex: 'water', render: RENDER.LIQUID, solid: false, opaque: false, atten: 2, sound: 'water' },
  { key: 'oak_log', name: 'Oak Log', tex: log('oak_log'), sound: 'wood' },
  { key: 'oak_leaves', name: 'Oak Leaves', tex: 'oak_leaves', ...leaves },
  { key: 'birch_log', name: 'Birch Log', tex: log('birch_log'), sound: 'wood' },
  { key: 'birch_leaves', name: 'Birch Leaves', tex: 'birch_leaves', ...leaves },
  { key: 'spruce_log', name: 'Spruce Log', tex: log('spruce_log'), sound: 'wood' },
  { key: 'spruce_leaves', name: 'Spruce Leaves', tex: 'spruce_leaves', ...leaves },
  { key: 'planks', name: 'Oak Planks', tex: 'planks', sound: 'wood' },
  { key: 'glass', name: 'Glass', tex: 'glass', opaque: false, cutout: true, selfCull: true, sound: 'glass' },
  { key: 'bricks', name: 'Bricks', tex: 'bricks', sound: 'stone' },
  { key: 'snow', name: 'Snow', tex: 'snow', sound: 'snow' },
  { key: 'snowy_grass', name: 'Snowy Grass', tex: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, sound: 'snow' },
  { key: 'sandstone', name: 'Sandstone', tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' }, sound: 'stone' },
  { key: 'cactus', name: 'Cactus', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus' }, opaque: false, cutout: true, inset: true, sound: 'cloth' },
  { key: 'coal_ore', name: 'Coal Ore', tex: 'coal_ore', sound: 'stone' },
  { key: 'iron_ore', name: 'Iron Ore', tex: 'iron_ore', sound: 'stone' },
  { key: 'gold_ore', name: 'Gold Ore', tex: 'gold_ore', sound: 'stone' },
  { key: 'diamond_ore', name: 'Diamond Ore', tex: 'diamond_ore', sound: 'stone' },
  { key: 'glowstone', name: 'Glowstone', tex: 'glowstone', emit: 15, sound: 'glass' },
  { key: 'tall_grass', name: 'Tall Grass', tex: 'tall_grass', ...plant },
  { key: 'poppy', name: 'Poppy', tex: 'poppy', ...plant },
  { key: 'dandelion', name: 'Dandelion', tex: 'dandelion', ...plant },
  { key: 'dead_bush', name: 'Dead Bush', tex: 'dead_bush', ...plant, onSand: true },
  { key: 'stone_bricks', name: 'Stone Bricks', tex: 'stone_bricks', sound: 'stone' },
  { key: 'bookshelf', name: 'Bookshelf', tex: { top: 'planks', bottom: 'planks', side: 'bookshelf' }, sound: 'wood' },
  { key: 'crafting_table', name: 'Crafting Table', tex: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' }, sound: 'wood' },
  { key: 'mossy_cobblestone', name: 'Mossy Cobblestone', tex: 'mossy_cobblestone', sound: 'stone' },
  { key: 'obsidian', name: 'Obsidian', tex: 'obsidian', sound: 'stone' },
  { key: 'wool_white', name: 'White Wool', tex: 'wool_white', sound: 'cloth' },
  { key: 'wool_red', name: 'Red Wool', tex: 'wool_red', sound: 'cloth' },
  { key: 'wool_yellow', name: 'Yellow Wool', tex: 'wool_yellow', sound: 'cloth' },
  { key: 'wool_lime', name: 'Lime Wool', tex: 'wool_lime', sound: 'cloth' },
  { key: 'wool_blue', name: 'Blue Wool', tex: 'wool_blue', sound: 'cloth' },
  { key: 'wool_black', name: 'Black Wool', tex: 'wool_black', sound: 'cloth' },
];

export const BLOCK_COUNT = DEFS.length;

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
export const FACE_TEX = new Uint8Array(256 * 6);

DEFS.forEach((d, id) => {
  const render = d.render ?? RENDER.CUBE;
  RENDER_TYPE[id] = render;
  SOLID[id] = (d.solid ?? true) ? 1 : 0;
  OPAQUE[id] = (d.opaque ?? true) ? 1 : 0;
  SELF_CULL[id] = d.selfCull ? 1 : 0;
  LEAVES[id] = d.leaves ? 1 : 0;
  INSET[id] = d.inset ? 1 : 0;
  PLANT[id] = d.plant ? 1 : 0;
  FALLS[id] = d.falls ? 1 : 0;
  EMIT[id] = d.emit ?? 0;
  ATTEN[id] = d.atten ?? 0;
  if (render === RENDER.NONE) return;
  const tex = typeof d.tex === 'string' ? { top: d.tex, bottom: d.tex, side: d.tex } : d.tex;
  const faces = [tex.side, tex.side, tex.top, tex.bottom, tex.side, tex.side];
  faces.forEach((name, f) => { FACE_TEX[id * 6 + f] = textureIndex(name); });
});

export const BLOCKS = DEFS.map((d, id) => ({
  id,
  key: d.key,
  name: d.name,
  sound: d.sound ?? 'stone',
  hidden: !!d.hidden,
  onSand: !!d.onSand,
  tex: d.tex,
}));

// Blocks a plant can sit on.
export function canSupportPlant(plantId, groundId) {
  if (BLOCKS[plantId].onSand) return groundId === B.SAND;
  return groundId === B.GRASS || groundId === B.DIRT || groundId === B.SNOWY_GRASS;
}

// Air, water and plants can be built into without breaking them first.
export function isReplaceable(id) {
  return id === B.AIR || id === B.WATER || PLANT[id] === 1;
}
