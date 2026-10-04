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
// efficiency: the tool's Efficiency level (it only helps when the tool already helps).
export function breakSeconds(id, itemKey, { inWater = false, onGround = true, efficiency = 0 } = {}) {
  const def = BLOCKS[id];
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0;
  const tool = toolOf(itemKey);
  let speed = 1;
  if (tool && def.tool && tool.type === def.tool) speed = tool.speed;
  if (tool?.type === 'shears' && (def.leaves || def.key.startsWith('wool'))) speed = def.leaves ? 15 : 5;
  if (tool?.type === 'sword' && def.leaves) speed = 1.5;
  if (efficiency > 0 && speed > 1) speed += efficiency * efficiency + 1;
  if (inWater) speed /= 5;
  if (!onGround) speed /= 5;
  const perTick = speed / def.hardness / (canHarvest(id, itemKey) ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick) / 20;
}

function roll(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Ores whose drops Fortune multiplies.
const FORTUNE_ORES = new Set(['coal_ore', 'diamond_ore', 'emerald_ore', 'lapis_ore', 'nether_quartz_ore']);
// Blocks Silk Touch can't lift whole: they come in parts or have no item.
const NO_SILK = (def) => def.crop !== undefined || def.door || def.bed || def.portal || def.entity === 'spawner';

// Item stacks a block gives when broken with `itemKey` in hand.
// silk: Silk Touch drops the block itself; fortune: Fortune's level.
export function dropsFor(id, itemKey, { silk = false, fortune = 0 } = {}) {
  const def = BLOCKS[id];
  if (!canHarvest(id, itemKey)) return [];
  const tool = toolOf(itemKey);
  if (silk && !NO_SILK(def)) {
    const whole = itemForBlock(id);
    if (whole) return [{ item: whole, count: 1 }];
  }
  if (def.leaves) {
    if (tool?.type === 'shears') return [{ item: def.key, count: 1 }];
    const out = [];
    const sapling = { [B.OAK_LEAVES]: 'oak_sapling', [B.BIRCH_LEAVES]: 'birch_sapling', [B.SPRUCE_LEAVES]: 'spruce_sapling' }[id];
    if (Math.random() < 0.05) out.push({ item: sapling, count: 1 });
    if (id === B.OAK_LEAVES && Math.random() < 0.005) out.push({ item: 'apple', count: 1 });
    if (Math.random() < 0.02) out.push({ item: 'stick', count: 1 + Math.floor(Math.random() * 2) });
    return out;
  }
  if (id === B.GRAVEL) return [{ item: Math.random() < [0.1, 0.14, 0.25, 1][Math.min(3, fortune)] ? 'flint' : 'gravel', count: 1 }];
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
    let n = roll(s.min ?? 1, s.max ?? 1);
    if (id === B.GLOWSTONE && fortune) n = Math.min(4, n + roll(0, fortune));
    if (n > 0) out.push({ item: s.item, count: n });
  }
  // Fortune: Minecraft's ore bonus multiplies the drop by 1 to (level + 1).
  if (fortune > 0 && FORTUNE_ORES.has(def.key)) {
    const mult = Math.max(0, roll(0, fortune + 1) - 1) + 1;
    for (const o of out) o.count *= mult;
  }
  return out;
}

// Experience a block gives when mined by a player (none with Silk Touch).
const BLOCK_XP = { coal_ore: [0, 2], diamond_ore: [3, 7], emerald_ore: [3, 7], lapis_ore: [2, 5], nether_quartz_ore: [2, 5], spawner: [15, 43] };
export function blockXp(id) {
  const range = BLOCK_XP[BLOCKS[id].key];
  return range ? roll(range[0], range[1]) : 0;
}

export function pickItemForBlock(id) {
  return itemForBlock(id);
}
