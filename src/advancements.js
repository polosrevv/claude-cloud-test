// Advancements double as the guide from punching the first tree to freeing
// the End: each one names the next step.
export const ADVANCEMENTS = [
  { id: 'wood', title: 'Getting Wood', about: 'Punch a tree until a log pops out', has: ['oak_log', 'birch_log', 'spruce_log'] },
  { id: 'crafting_table', title: 'Benchmarking', about: 'Turn logs into planks, then craft a crafting table', has: ['crafting_table'] },
  { id: 'wooden_pickaxe', title: 'Time to Mine!', about: 'Use planks and sticks to make a pickaxe', has: ['wooden_pickaxe'] },
  { id: 'stone', title: 'Stone Age', about: 'Mine stone with your new pickaxe', has: ['cobblestone'] },
  { id: 'stone_pickaxe', title: 'Getting an Upgrade', about: 'Construct a better pickaxe', has: ['stone_pickaxe'] },
  { id: 'furnace', title: 'Hot Topic', about: 'Construct a furnace out of eight cobblestone', has: ['furnace'] },
  { id: 'iron', title: 'Acquire Hardware', about: 'Smelt iron ore into an iron ingot', has: ['iron_ingot'] },
  { id: 'iron_pickaxe', title: "Isn't It Iron Pick", about: 'Upgrade your pickaxe', has: ['iron_pickaxe'] },
  { id: 'armor', title: 'Suit Up', about: 'Protect yourself with a piece of iron armor', wears: 'iron' },
  { id: 'bread', title: 'Bake Bread', about: 'Grow wheat on farmland and turn it into bread', has: ['bread'] },
  { id: 'kill', title: 'Monster Hunter', about: 'Kill any hostile monster', event: 'kill' },
  { id: 'sleep', title: 'Sweet Dreams', about: 'Sleep in a bed to change your respawn point', event: 'sleep' },
  { id: 'diamonds', title: 'Diamonds!', about: 'Acquire diamonds (they lie deep, below y=16)', has: ['diamond'] },
  { id: 'lava', title: 'Hot Stuff', about: 'Fill a bucket with lava', has: ['lava_bucket'] },
  { id: 'obsidian', title: 'Ice Bucket Challenge', about: 'Pour water on still lava and mine the obsidian with a diamond pickaxe', has: ['obsidian'] },
  { id: 'enchant', title: 'Enchanter', about: 'Enchant an item at an enchanting table made from a book, two diamonds and four obsidian', event: 'enchant' },
  { id: 'nether', title: 'We Need to Go Deeper', about: 'Build a 4x5 obsidian frame, light it with flint and steel, and step through', event: 'nether' },
  { id: 'fortress', title: 'A Terrible Fortress', about: 'Break your way into a Nether Fortress', event: 'fortress' },
  { id: 'blaze_rod', title: 'Into Fire', about: 'Relieve a Blaze of its rod', has: ['blaze_rod'] },
  { id: 'ender_pearl', title: 'Pearls of the Night', about: 'Hunt an Enderman for an ender pearl', has: ['ender_pearl'] },
  { id: 'eye', title: 'Eye Spy', about: 'Craft eyes of ender, throw them, and follow them to a stronghold', event: 'stronghold' },
  { id: 'end', title: 'The End?', about: 'Fill the twelve portal frames with eyes and jump in', event: 'end' },
  { id: 'dragon', title: 'Free the End', about: 'Bring blocks to climb onto the island, shoot the end crystals, then slay the Ender Dragon', event: 'dragon' },
  { id: 'egg', title: 'The Next Generation', about: 'Hold the Dragon Egg', has: ['dragon_egg'] },
];

export class Advancements {
  constructor(done = [], onUnlock = () => {}) {
    this.done = new Set(done);
    this.onUnlock = onUnlock;
  }

  unlock(id) {
    if (this.done.has(id)) return;
    const a = ADVANCEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.done.add(id);
    this.onUnlock(a);
  }

  event(name) {
    for (const a of ADVANCEMENTS) if (a.event === name) this.unlock(a.id);
  }

  // Check item-based advancements against the inventory.
  check(inventory) {
    const owned = new Set();
    for (const s of inventory.main.slots) if (s) owned.add(s.item);
    if (inventory.cursor) owned.add(inventory.cursor.item);
    for (const a of ADVANCEMENTS) {
      if (this.done.has(a.id)) continue;
      if (a.has?.some((item) => owned.has(item))) this.unlock(a.id);
      if (a.wears && inventory.armor.slots.some((s) => s?.item.startsWith(a.wears))) this.unlock(a.id);
    }
  }

  // The first advancement not yet earned: the suggested next goal.
  next() {
    return ADVANCEMENTS.find((a) => !this.done.has(a.id)) ?? null;
  }

  serialize() {
    return [...this.done];
  }
}
