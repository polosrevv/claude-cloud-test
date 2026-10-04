// Status effects, potions and brewing, after Minecraft: effects tick on the
// player (and a few on mobs); potions are brewed from water bottles with nether
// wart, then an ingredient, then optionally glowstone for strength and
// gunpowder to make them splash.

// color: the liquid in the bottle and the swirl on the HUD.
export const EFFECTS = {
  speed: { name: 'Speed', color: [124, 175, 198] },
  slowness: { name: 'Slowness', color: [90, 108, 129], bad: true },
  strength: { name: 'Strength', color: [147, 36, 35] },
  weakness: { name: 'Weakness', color: [72, 77, 72], bad: true },
  regeneration: { name: 'Regeneration', color: [205, 92, 171] },
  poison: { name: 'Poison', color: [78, 147, 49], bad: true },
  wither: { name: 'Wither', color: [53, 42, 39], bad: true },
  fire_resistance: { name: 'Fire Resistance', color: [228, 154, 58] },
  instant_health: { name: 'Instant Health', color: [248, 36, 35], instant: true },
  instant_damage: { name: 'Instant Damage', color: [67, 10, 9], instant: true, bad: true },
  hunger: { name: 'Hunger', color: [88, 118, 83], bad: true },
};

// Drinkable potions: key -> [effect, level (0 = I), seconds]. Awkward has no effect.
const BASE = {
  awkward: null,
  healing: ['instant_health', 0, 0],
  healing_2: ['instant_health', 1, 0],
  harming: ['instant_damage', 0, 0],
  harming_2: ['instant_damage', 1, 0],
  regeneration: ['regeneration', 0, 45],
  regeneration_2: ['regeneration', 1, 22],
  swiftness: ['speed', 0, 180],
  swiftness_2: ['speed', 1, 90],
  slowness: ['slowness', 0, 90],
  strength: ['strength', 0, 180],
  strength_2: ['strength', 1, 90],
  weakness: ['weakness', 0, 90],
  poison: ['poison', 0, 45],
  poison_2: ['poison', 1, 21],
  fire_resistance: ['fire_resistance', 0, 180],
};

const NAMES = {
  awkward: 'Awkward Potion', healing: 'Potion of Healing', harming: 'Potion of Harming', regeneration: 'Potion of Regeneration',
  swiftness: 'Potion of Swiftness', slowness: 'Potion of Slowness', strength: 'Potion of Strength', weakness: 'Potion of Weakness',
  poison: 'Potion of Poison', fire_resistance: 'Potion of Fire Resistance',
};

// Every potion item: potion_<base> and splash_potion_<base>.
export const POTIONS = {};
for (const [base, effect] of Object.entries(BASE)) {
  const plain = base.replace(/_2$/, '');
  const name = NAMES[plain] + (base.endsWith('_2') ? ' II' : '');
  const color = effect ? EFFECTS[effect[0]].color : [52, 84, 210];
  POTIONS[`potion_${base}`] = { base, name, effect, color, splash: false };
  if (base !== 'awkward') POTIONS[`splash_potion_${base}`] = { base, name: `Splash ${name}`, effect, color, splash: true };
}

// Brewing: [from base, ingredient] -> to base ('water' is a water bottle).
const BREW = [
  ['water', 'nether_wart', 'awkward'],
  ['water', 'fermented_spider_eye', 'weakness'],
  ['awkward', 'glistering_melon', 'healing'],
  ['awkward', 'ghast_tear', 'regeneration'],
  ['awkward', 'sugar', 'swiftness'],
  ['awkward', 'blaze_powder', 'strength'],
  ['awkward', 'spider_eye', 'poison'],
  ['awkward', 'magma_cream', 'fire_resistance'],
  ['healing', 'fermented_spider_eye', 'harming'],
  ['poison', 'fermented_spider_eye', 'harming'],
  ['swiftness', 'fermented_spider_eye', 'slowness'],
  ['healing', 'glowstone_dust', 'healing_2'],
  ['harming', 'glowstone_dust', 'harming_2'],
  ['regeneration', 'glowstone_dust', 'regeneration_2'],
  ['swiftness', 'glowstone_dust', 'swiftness_2'],
  ['strength', 'glowstone_dust', 'strength_2'],
  ['poison', 'glowstone_dust', 'poison_2'],
];

export const BREWING_INGREDIENTS = new Set([...BREW.map((b) => b[1]), 'gunpowder']);

// What a bottle becomes when brewed with an ingredient (null if nothing happens).
export function brewResult(bottle, ingredient) {
  if (!bottle) return null;
  if (bottle === 'water_bottle') {
    const hit = BREW.find(([from, ing]) => from === 'water' && ing === ingredient);
    return hit ? `potion_${hit[2]}` : null;
  }
  const p = POTIONS[bottle];
  if (!p) return null;
  if (ingredient === 'gunpowder') return !p.splash && p.base !== 'awkward' ? `splash_potion_${p.base}` : null;
  const hit = BREW.find(([from, ing]) => from === p.base && ing === ingredient);
  return hit ? `${p.splash ? 'splash_' : ''}potion_${hit[2]}` : null;
}

// Add an effect to a holder ({ effects }), keeping the stronger or longer one.
export function addEffect(holder, key, level, ticks) {
  holder.effects ??= {};
  const cur = holder.effects[key];
  if (!cur || level > cur.level || (level === cur.level && ticks > cur.ticks)) holder.effects[key] = { level, ticks };
}

export function effectLevel(holder, key) {
  const e = holder.effects?.[key];
  return e && e.ticks > 0 ? e.level + 1 : 0;
}

export function formatTicks(ticks) {
  const s = Math.ceil(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
