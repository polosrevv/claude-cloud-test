// Enchantments and experience, following Minecraft's rules: what each
// enchantment does, which items can take it, the enchanting table's three
// offers (bookshelves raise them), and the XP needed for each level.
import { ITEMS } from './items.js';
import { mulberry32 } from './noise.js';

// power: [min power for level 1, extra per level, width of the window].
export const ENCHANTMENTS = {
  protection: { name: 'Protection', max: 4, on: ['armor'], weight: 10, power: [1, 11, 11], group: 'protection' },
  fire_protection: { name: 'Fire Protection', max: 4, on: ['armor'], weight: 5, power: [10, 8, 8], group: 'protection' },
  feather_falling: { name: 'Feather Falling', max: 4, on: ['boots'], weight: 5, power: [5, 6, 6] },
  respiration: { name: 'Respiration', max: 3, on: ['helmet'], weight: 2, power: [10, 10, 30] },
  aqua_affinity: { name: 'Aqua Affinity', max: 1, on: ['helmet'], weight: 2, power: [1, 0, 40] },
  sharpness: { name: 'Sharpness', max: 5, on: ['sword'], weight: 10, power: [1, 11, 20], group: 'damage' },
  smite: { name: 'Smite', max: 5, on: ['sword'], weight: 5, power: [5, 8, 20], group: 'damage' },
  bane_of_arthropods: { name: 'Bane of Arthropods', max: 5, on: ['sword'], weight: 5, power: [5, 8, 20], group: 'damage' },
  knockback: { name: 'Knockback', max: 2, on: ['sword'], weight: 5, power: [5, 20, 50] },
  fire_aspect: { name: 'Fire Aspect', max: 2, on: ['sword'], weight: 2, power: [10, 20, 50] },
  looting: { name: 'Looting', max: 3, on: ['sword'], weight: 2, power: [15, 9, 50] },
  efficiency: { name: 'Efficiency', max: 5, on: ['digger', 'shears'], weight: 10, power: [1, 10, 50] },
  silk_touch: { name: 'Silk Touch', max: 1, on: ['digger'], weight: 1, power: [15, 0, 50], group: 'drops' },
  fortune: { name: 'Fortune', max: 3, on: ['digger'], weight: 2, power: [15, 9, 50], group: 'drops' },
  unbreaking: { name: 'Unbreaking', max: 3, on: ['damageable'], weight: 5, power: [5, 8, 50] },
  power: { name: 'Power', max: 5, on: ['bow'], weight: 10, power: [1, 10, 15] },
  punch: { name: 'Punch', max: 2, on: ['bow'], weight: 2, power: [12, 20, 25] },
  flame: { name: 'Flame', max: 1, on: ['bow'], weight: 2, power: [20, 0, 30] },
  infinity: { name: 'Infinity', max: 1, on: ['bow'], weight: 1, power: [20, 0, 30] },
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export function enchantName(key, level) {
  const e = ENCHANTMENTS[key];
  return e.max === 1 ? e.name : `${e.name} ${ROMAN[level] ?? level}`;
}

// How readily an item takes enchantments (Minecraft's enchantability).
const ENCHANTABILITY = {
  wooden: 15, stone: 5, iron: 14, golden: 22, diamond: 10, leather: 15, iron_armor: 9, golden_armor: 25, diamond_armor: 10,
};

export function enchantability(itemKey) {
  const item = ITEMS[itemKey];
  if (!item) return 0;
  if (item.key === 'bow' || item.key === 'book' || item.key === 'fishing_rod') return 1;
  if (item.armor) {
    const mat = itemKey.split('_')[0];
    return ENCHANTABILITY[mat === 'leather' ? 'leather' : `${mat}_armor`] ?? 0;
  }
  if (item.tool && item.tool.type !== 'shears') return ENCHANTABILITY[itemKey.split('_')[0]] ?? 0;
  return 0;
}

// Does this enchantment fit this item?
export function fits(key, itemKey) {
  const item = ITEMS[itemKey];
  if (!item) return false;
  const tool = item.tool?.type;
  const slot = item.armor?.slot;
  return ENCHANTMENTS[key].on.some((on) => {
    switch (on) {
      case 'armor': return !!item.armor;
      case 'helmet': return slot === 0;
      case 'boots': return slot === 3;
      case 'sword': return tool === 'sword';
      case 'digger': return tool === 'pickaxe' || tool === 'axe' || tool === 'shovel';
      case 'shears': return tool === 'shears';
      case 'bow': return item.key === 'bow';
      case 'damageable': return !!(item.durability || item.tool?.durability || item.armor);
      default: return false;
    }
  });
}

const compatible = (a, b) => a !== b && !(ENCHANTMENTS[a].group && ENCHANTMENTS[a].group === ENCHANTMENTS[b].group);

// Level of an enchantment on a stack (0 when it has none).
export function level(stack, key) {
  return stack?.ench?.[key] ?? 0;
}

export function describe(stack) {
  return Object.entries(stack?.ench ?? {}).map(([k, l]) => enchantName(k, l));
}

// Enchantments the table can roll at a given power, with the level that power earns.
function candidates(itemKey, power) {
  const out = [];
  for (const [key, e] of Object.entries(ENCHANTMENTS)) {
    if (!fits(key, itemKey)) continue;
    for (let l = e.max; l >= 1; l--) {
      const min = e.power[0] + e.power[1] * (l - 1);
      if (power >= min && power <= min + e.power[2]) {
        out.push({ key, level: l, weight: e.weight });
        break;
      }
    }
  }
  return out;
}

function pickWeighted(list, r) {
  const total = list.reduce((n, c) => n + c.weight, 0);
  let x = r() * total;
  for (const c of list) {
    x -= c.weight;
    if (x < 0) return c;
  }
  return list[list.length - 1];
}

// The enchantments an item gets for a given cost in levels.
export function rollEnchantments(itemKey, cost, seed) {
  const r = mulberry32(seed);
  const ability = enchantability(itemKey);
  if (!ability) return [];
  let power = cost + 1 + Math.floor(r() * (Math.floor(ability / 4) + 1)) + Math.floor(r() * (Math.floor(ability / 4) + 1));
  power = Math.max(1, Math.round(power * (1 + (r() + r() - 1) * 0.15)));
  let pool = candidates(itemKey, power);
  if (!pool.length) return [];
  const chosen = [pickWeighted(pool, r)];
  while (r() < (power + 1) / 50) {
    pool = pool.filter((c) => chosen.every((k) => compatible(k.key, c.key)));
    if (!pool.length) break;
    chosen.push(pickWeighted(pool, r));
    power = Math.floor(power / 2);
  }
  return chosen.map(({ key, level: l }) => ({ key, level: l }));
}

// The three offers for an item: level costs grow with nearby bookshelves (max 15).
export function enchantOffers(itemKey, shelves, seed) {
  if (!enchantability(itemKey)) return [null, null, null];
  const r = mulberry32(seed);
  const b = Math.min(15, shelves);
  const base = 1 + Math.floor(r() * 8) + Math.floor(b / 2) + Math.floor(r() * (b + 1));
  const costs = [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
  return costs.map((cost, i) => {
    const ench = rollEnchantments(itemKey, cost, seed + i * 7919);
    if (!ench.length || cost < i + 1) return null;
    return { cost, lapis: i + 1, ench, hint: ench[0] };
  });
}

// ---- Experience ----

// Points needed to go from `lvl` to `lvl + 1`.
export function xpToNext(lvl) {
  if (lvl >= 30) return 9 * lvl - 158;
  if (lvl >= 15) return 5 * lvl - 38;
  return 2 * lvl + 7;
}

// Add (or with a negative number, remove) points: { level, progress } where progress is 0..1.
export function addPoints(state, points) {
  let pts = state.progress * xpToNext(state.level) + points;
  let lvl = state.level;
  while (pts >= xpToNext(lvl)) {
    pts -= xpToNext(lvl);
    lvl++;
  }
  while (pts < 0 && lvl > 0) {
    lvl--;
    pts += xpToNext(lvl);
  }
  return { level: lvl, progress: Math.max(0, pts) / xpToNext(lvl) };
}

// Total points a level represents, for dropping XP on death.
export function totalPoints(state) {
  let n = 0;
  for (let l = 0; l < state.level; l++) n += xpToNext(l);
  return Math.floor(n + state.progress * xpToNext(state.level));
}

// Orb sizes Minecraft splits XP into.
const ORB_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
export function splitXp(points) {
  const out = [];
  let left = Math.floor(points);
  while (left > 0) {
    const size = ORB_SIZES.find((s) => s <= left);
    out.push(size);
    left -= size;
  }
  return out;
}
