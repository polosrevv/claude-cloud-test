// Inventories, Minecraft-style slot clicking, furnace smelting and chest loot.
import { ITEMS, maxStack } from './items.js';
import { matchRecipe, SMELTING, SMELT_XP } from './recipes.js';
import { mulberry32 } from './noise.js';

export const clone = (s) => {
  if (!s) return null;
  const c = { item: s.item, count: s.count, damage: s.damage || 0 };
  if (s.ench && Object.keys(s.ench).length) c.ench = { ...s.ench };
  return c;
};
export const canStack = (a, b) => !!a && !!b && a.item === b.item && maxStack(a.item) > 1 && !(a.damage || b.damage) && !a.ench && !b.ench;

export class Inventory {
  constructor(size) {
    this.slots = new Array(size).fill(null);
  }

  get size() {
    return this.slots.length;
  }

  // Adds as much of the stack as fits (topping up matching stacks first).
  // Returns how many items didn't fit. `order` lists slot indices to try.
  add(stack, order = null) {
    let left = stack.count;
    const idx = order ?? this.slots.map((_, i) => i);
    for (const i of idx) {
      const s = this.slots[i];
      if (left > 0 && s && canStack(s, stack)) {
        const room = maxStack(s.item) - s.count;
        const n = Math.min(room, left);
        s.count += n;
        left -= n;
      }
    }
    for (const i of idx) {
      if (left > 0 && !this.slots[i]) {
        const n = Math.min(maxStack(stack.item), left);
        this.slots[i] = { ...clone(stack), count: n };
        left -= n;
      }
    }
    return left;
  }

  count(item) {
    return this.slots.reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0);
  }

  remove(item, count) {
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.item !== item) continue;
      const n = Math.min(s.count, left);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    return count - left;
  }

  clear() {
    this.slots.fill(null);
  }

  serialize() {
    return this.slots.map(clone);
  }

  load(list) {
    this.slots = this.slots.map((_, i) => {
      const s = list?.[i];
      return s && ITEMS[s.item] && s.count > 0 ? clone(s) : null;
    });
  }
}

// Player storage: 36 slots (0-8 are the hotbar), 4 armour slots, 2x2 crafting grid.
export class PlayerInventory {
  constructor() {
    this.main = new Inventory(36);
    this.armor = new Inventory(4);
    this.craft = new Inventory(4);
    this.cursor = null;
  }

  // Hotbar first, then the rest, like picking things up in Minecraft.
  give(stack) {
    const order = [...Array(9).keys(), ...Array.from({ length: 27 }, (_, i) => i + 9)];
    return this.main.add(stack, order);
  }

  armorPoints() {
    return this.armor.slots.reduce((n, s) => n + (s ? ITEMS[s.item].armor?.points ?? 0 : 0), 0);
  }

  serialize() {
    return { main: this.main.serialize(), armor: this.armor.serialize(), craft: this.craft.serialize(), cursor: clone(this.cursor) };
  }

  load(data) {
    this.main.load(data?.main);
    this.armor.load(data?.armor);
    this.craft.load(data?.craft);
    this.cursor = data?.cursor && ITEMS[data.cursor.item] ? clone(data.cursor) : null;
  }
}

// ---- Slot clicking ----
// A slot is { inv, index, kind, accept? } where kind is 'normal', 'armor',
// 'fuel', 'result' or 'craft-result', and section names a group for shift-click.

function accepts(slot, stack) {
  if (!stack) return true;
  if (slot.kind === 'result' || slot.kind === 'craft-result') return false;
  if (slot.kind === 'armor') return ITEMS[stack.item]?.armor?.slot === slot.armorSlot;
  if (slot.kind === 'fuel') return (ITEMS[stack.item]?.fuel ?? 0) > 0;
  if (slot.kind === 'lapis') return stack.item === 'lapis_lazuli';
  return true;
}

// Armour and the enchanting table's item slot hold a single item.
const slotLimit = (slot, item) => (slot.kind === 'armor' || slot.kind === 'enchant-item' ? 1 : maxStack(item));

// Left (button 0) or right (button 2) click on a normal slot with the cursor.
export function clickSlot(holder, slot, button) {
  const cur = holder.cursor;
  const s = slot.inv.slots[slot.index];
  if (button === 0) {
    if (!cur) {
      holder.cursor = s;
      slot.inv.slots[slot.index] = null;
    } else if (!s) {
      if (!accepts(slot, cur)) return;
      const limit = slotLimit(slot, cur.item);
      const n = Math.min(cur.count, limit);
      slot.inv.slots[slot.index] = { ...clone(cur), count: n };
      cur.count -= n;
      if (cur.count <= 0) holder.cursor = null;
    } else if (canStack(s, cur)) {
      const n = Math.min(slotLimit(slot, s.item) - s.count, cur.count);
      s.count += n;
      cur.count -= n;
      if (cur.count <= 0) holder.cursor = null;
    } else if (accepts(slot, cur)) {
      slot.inv.slots[slot.index] = cur;
      holder.cursor = s;
    }
  } else if (button === 2) {
    if (!cur) {
      if (!s) return;
      const half = Math.ceil(s.count / 2);
      holder.cursor = { ...clone(s), count: half };
      s.count -= half;
      if (s.count <= 0) slot.inv.slots[slot.index] = null;
    } else if (!s) {
      if (!accepts(slot, cur)) return;
      slot.inv.slots[slot.index] = { ...clone(cur), count: 1 };
      cur.count -= 1;
      if (cur.count <= 0) holder.cursor = null;
    } else if (canStack(s, cur) && s.count < slotLimit(slot, s.item)) {
      s.count += 1;
      cur.count -= 1;
      if (cur.count <= 0) holder.cursor = null;
    } else if (accepts(slot, cur)) {
      slot.inv.slots[slot.index] = cur;
      holder.cursor = s;
    }
  }
}

// Move a slot's whole stack into the first fitting slots of `targets`.
export function quickMove(slot, targets) {
  const s = slot.inv.slots[slot.index];
  if (!s) return;
  const fits = targets.filter((t) => accepts(t, s) && t.kind !== 'result' && t.kind !== 'craft-result');
  let left = s.count;
  for (const pass of [0, 1]) {
    for (const t of fits) {
      if (left <= 0) break;
      const other = t.inv.slots[t.index];
      if (pass === 0 && other && canStack(other, s)) {
        const n = Math.min(slotLimit(t, s.item) - other.count, left);
        other.count += n;
        left -= n;
      } else if (pass === 1 && !other) {
        const limit = slotLimit(t, s.item);
        const n = Math.min(limit, left);
        t.inv.slots[t.index] = { ...clone(s), count: n };
        left -= n;
      }
    }
  }
  if (left <= 0) slot.inv.slots[slot.index] = null;
  else s.count = left;
}

// ---- Crafting ----
export function craftingResult(grid, size) {
  const names = grid.slots.map((s) => s?.item ?? null);
  return matchRecipe(names, size, size);
}

// Take one batch from a crafting grid. Returns the crafted stack or null.
export function takeCraft(grid, size) {
  const r = craftingResult(grid, size);
  if (!r) return null;
  for (let i = 0; i < grid.slots.length; i++) {
    const s = grid.slots[i];
    if (!s) continue;
    s.count -= 1;
    // Buckets of milk leave their buckets behind.
    const left = ITEMS[s.item]?.remainder;
    if (s.count <= 0) grid.slots[i] = left ? { item: left, count: 1, damage: 0 } : null;
  }
  return { item: r.item, count: r.count, damage: 0 };
}

// ---- Furnaces ----
// data.slots: [input, fuel, output]; times in game ticks.
export const SMELT_TICKS = 200;

export function newFurnace() {
  return { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
}

function smeltResult(input) {
  return input ? SMELTING[input.item] ?? null : null;
}

// One game tick. Returns true when the furnace switches between lit and unlit.
export function tickFurnace(f) {
  const wasLit = f.burn > 0;
  const [input, fuel, output] = f.slots;
  const result = smeltResult(input);
  const room = result && (!output || (output.item === result && output.count < maxStack(result)));
  if (f.burn > 0) f.burn--;
  if (f.burn <= 0 && room && fuel) {
    const ticks = Math.round((ITEMS[fuel.item]?.fuel ?? 0) * SMELT_TICKS);
    if (ticks > 0) {
      f.burn = f.burnMax = ticks;
      if (fuel.item === 'lava_bucket') f.slots[1] = { item: 'bucket', count: 1, damage: 0 };
      else {
        fuel.count -= 1;
        if (fuel.count <= 0) f.slots[1] = null;
      }
    }
  }
  if (f.burn > 0 && room) {
    f.cook++;
    if (f.cook >= SMELT_TICKS) {
      f.cook = 0;
      f.xp = (f.xp ?? 0) + (SMELT_XP[input.item] ?? 0.1);
      input.count -= 1;
      if (input.count <= 0) f.slots[0] = null;
      if (output) output.count += 1;
      else f.slots[2] = { item: result, count: 1, damage: 0 };
    }
  } else if (f.cook > 0) {
    f.cook = Math.max(0, f.cook - 2);
  }
  return wasLit !== f.burn > 0;
}

// ---- Loot ----
const LOOT = {
  dungeon: [
    ['bread', 1, 2, 0.6], ['wheat', 1, 4, 0.5], ['iron_ingot', 1, 4, 0.45], ['gold_ingot', 1, 3, 0.25],
    ['string', 1, 4, 0.4], ['gunpowder', 1, 4, 0.4], ['bone', 1, 4, 0.4], ['rotten_flesh', 1, 4, 0.4],
    ['bucket', 1, 1, 0.15], ['golden_apple', 1, 1, 0.06], ['diamond', 1, 2, 0.08], ['coal', 3, 8, 0.4],
  ],
  stronghold: [
    ['ender_pearl', 1, 3, 0.6], ['bread', 1, 3, 0.6], ['apple', 1, 3, 0.5], ['iron_ingot', 1, 5, 0.5],
    ['gold_ingot', 1, 3, 0.3], ['diamond', 1, 3, 0.2], ['iron_pickaxe', 1, 1, 0.15], ['iron_sword', 1, 1, 0.15],
    ['iron_chestplate', 1, 1, 0.1], ['blaze_rod', 1, 2, 0.25],
  ],
  fortress: [
    ['gold_ingot', 1, 3, 0.6], ['iron_ingot', 1, 5, 0.5], ['diamond', 1, 3, 0.25], ['flint_and_steel', 1, 1, 0.25],
    ['obsidian', 2, 4, 0.2], ['golden_chestplate', 1, 1, 0.15], ['blaze_rod', 1, 3, 0.4],
  ],
};

export function generateLoot(table, seed) {
  const r = mulberry32(seed >>> 0);
  const inv = new Inventory(27);
  for (const [item, min, max, chance] of LOOT[table] || LOOT.dungeon) {
    if (r() > chance) continue;
    const count = min + Math.floor(r() * (max - min + 1));
    let slot = Math.floor(r() * 27);
    while (inv.slots[slot]) slot = (slot + 1) % 27;
    inv.slots[slot] = { item, count, damage: 0 };
  }
  return inv.serialize();
}
