// What a block drops and how long it takes to mine, following Minecraft's
// rules: the right tool is faster, and some blocks need a good enough pickaxe
// (stone for iron ore, iron for gold and diamond, diamond for obsidian).
import { B, BLOCKS } from './blocks.js';
import { ITEMS, itemForBlock } from './items.js';

export function toolOf(itemKey) {
  return itemKey ? ITEMS[itemKey]?.tool ?? null : null;
}

export function canHarvest(id, itemKey) {
  const def = BLOCKS[id];
  if (def.harvest) return toolOf(itemKey)?.type === def.harvest;
  if (def.tier === undefined) return true;
  const tool = toolOf(itemKey);
  return !!tool && tool.type === def.tool && tool.tier >= def.tier;
}

// Seconds to break a block in survival, or Infinity when it can't be broken.
export function breakSeconds(id, itemKey, { inWater = false, onGround = true } = {}) {
  const def = BLOCKS[id];
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0;
  const tool = toolOf(itemKey);
  let speed = 1;
  if (tool && def.tool && tool.type === def.tool) speed = tool.speed;
  if (tool?.type === 'shears' && (def.leaves || def.key.startsWith('wool'))) speed = def.leaves ? 15 : 5;
  if (tool?.type === 'sword' && def.leaves) speed = 1.5;
  if (inWater) speed /= 5;
  if (!onGround) speed /= 5;
  const perTick = speed / def.hardness / (canHarvest(id, itemKey) ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick) / 20;
}

function roll(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Item stacks a block gives when broken with `itemKey` in hand.
export function dropsFor(id, itemKey) {
  const def = BLOCKS[id];
  if (!canHarvest(id, itemKey)) return [];
  const tool = toolOf(itemKey);
  if (def.leaves) {
    if (tool?.type === 'shears') return [{ item: def.key, count: 1 }];
    const out = [];
    const sapling = { [B.OAK_LEAVES]: 'oak_sapling', [B.BIRCH_LEAVES]: 'birch_sapling', [B.SPRUCE_LEAVES]: 'spruce_sapling' }[id];
    if (Math.random() < 0.05) out.push({ item: sapling, count: 1 });
    if (id === B.OAK_LEAVES && Math.random() < 0.005) out.push({ item: 'apple', count: 1 });
    if (Math.random() < 0.02) out.push({ item: 'stick', count: 1 + Math.floor(Math.random() * 2) });
    return out;
  }
  if (id === B.GRAVEL) return [{ item: Math.random() < 0.1 ? 'flint' : 'gravel', count: 1 }];
  if (id === B.TALL_GRASS && tool?.type === 'shears') return [{ item: 'tall_grass', count: 1 }];
  const spec = def.drops === undefined ? def.item : def.drops;
  if (spec === null || spec === undefined) return [];
  const list = Array.isArray(spec) ? spec : [spec];
  const out = [];
  for (const s of list) {
    if (typeof s === 'string') {
      if (ITEMS[s]) out.push({ item: s, count: 1 });
      continue;
    }
    if (s.chance !== undefined && Math.random() > s.chance) continue;
    const n = roll(s.min ?? 1, s.max ?? 1);
    if (n > 0) out.push({ item: s.item, count: n });
  }
  return out;
}

export function pickItemForBlock(id) {
  return itemForBlock(id);
}
