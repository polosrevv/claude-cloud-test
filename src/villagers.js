// Villager professions and what they trade, after Minecraft 1.8: each villager
// buys a raw material for an emerald and sells finished goods for emeralds.
// A villager's offers are fixed by its seed; each one can be used a few
// times before the villager needs a while to restock.
import { mulberry32 } from './noise.js';
import { rollEnchantments } from './enchantments.js';

export const PROFESSIONS = {
  farmer: { name: 'Farmer' },
  librarian: { name: 'Librarian' },
  priest: { name: 'Cleric' },
  smith: { name: 'Blacksmith' },
  butcher: { name: 'Butcher' },
};

const range = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// [kind, item, count range, emeralds range]: 'buy' means the villager buys
// count of item for emeralds; 'sell' means it sells count of item for emeralds.
const OFFERS = {
  farmer: [
    ['buy', 'wheat', [18, 22], [1, 1]],
    ['buy', 'pumpkin', [8, 13], [1, 1]],
    ['buy', 'melon', [7, 12], [1, 1]],
    ['sell', 'bread', [2, 4], [1, 1]],
    ['sell', 'apple', [5, 7], [1, 1]],
    ['sell', 'pumpkin_pie', [2, 3], [1, 1]],
    ['sell', 'cake', [1, 1], [1, 1]],
  ],
  librarian: [
    ['buy', 'paper', [24, 36], [1, 1]],
    ['buy', 'book', [8, 10], [1, 1]],
    ['sell', 'bookshelf', [1, 1], [3, 4]],
    ['sell', 'glass', [3, 5], [1, 1]],
    ['sell', 'paper', [8, 12], [1, 1]],
  ],
  priest: [
    ['buy', 'rotten_flesh', [36, 40], [1, 1]],
    ['buy', 'gold_ingot', [8, 10], [1, 1]],
    ['sell', 'lapis_lazuli', [1, 2], [1, 1]],
    ['sell', 'glowstone', [1, 3], [1, 1]],
    ['sell', 'eye_of_ender', [1, 1], [7, 11]],
    ['sell', 'ender_pearl', [1, 1], [4, 7]],
  ],
  smith: [
    ['buy', 'coal', [16, 24], [1, 1]],
    ['buy', 'iron_ingot', [7, 9], [1, 1]],
    ['buy', 'diamond', [3, 4], [1, 1]],
    ['sell', 'iron_sword', [1, 1], [7, 9], 'enchant'],
    ['sell', 'iron_pickaxe', [1, 1], [7, 9], 'enchant'],
    ['sell', 'iron_chestplate', [1, 1], [10, 14], 'enchant'],
    ['sell', 'diamond_sword', [1, 1], [12, 14], 'enchant'],
    ['sell', 'diamond_pickaxe', [1, 1], [12, 14], 'enchant'],
  ],
  butcher: [
    ['buy', 'porkchop', [14, 18], [1, 1]],
    ['buy', 'chicken', [14, 18], [1, 1]],
    ['sell', 'cooked_porkchop', [5, 7], [1, 1]],
    ['sell', 'cooked_chicken', [6, 8], [1, 1]],
    ['sell', 'steak', [5, 7], [1, 1]],
  ],
};

// Four or five offers, always starting with a way to earn emeralds.
export function tradesFor(profession, seed) {
  const r = mulberry32(seed);
  const pool = OFFERS[profession] ?? OFFERS.farmer;
  const buys = pool.filter((o) => o[0] === 'buy');
  const sells = pool.filter((o) => o[0] === 'sell');
  const pick = (list, n) => [...list].sort(() => r() - 0.5).slice(0, n);
  const chosen = [...pick(buys, 2), ...pick(sells, 2 + (r() < 0.5 ? 1 : 0))];
  return chosen.map(([kind, item, counts, emeralds, extra]) => {
    const count = range(r, ...counts);
    const price = range(r, ...emeralds);
    const trade = kind === 'buy'
      ? { give: [{ item, count }], get: { item: 'emerald', count: price } }
      : { give: [{ item: 'emerald', count: price }], get: { item, count } };
    if (extra === 'enchant' && r() < 0.6) {
      const ench = rollEnchantments(item, 5 + Math.floor(r() * 15), Math.floor(r() * 1e9));
      if (ench.length) trade.get.ench = Object.fromEntries(ench.map((e) => [e.key, e.level]));
    }
    trade.uses = 0;
    trade.max = range(r, 6, 12);
    return trade;
  });
}
