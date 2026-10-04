// Everything that happens to blocks on its own: neighbour updates (plants and
// torches popping off, sand falling, portals collapsing), flowing water and
// lava, and random ticks (crops, saplings, grass, cactus, leaves decaying).
import {
  B, BLOCKS, SOLID, FLUID, FLUID_LEVEL, PLANT, FALLS, LEAVES, OPAQUE, FACING_DIR,
  canSupportPlant, fluidBlock,
} from './blocks.js';
import { CHUNK, HEIGHT, blockIndex } from './constants.js';
import { broadleafTree, spruceTree } from './structures.js';

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const NEIGHBOURS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class BlockUpdater {
  constructor(game) {
    this.game = game;
    this.queue = [];
  }

  get world() {
    return this.game.world;
  }

  // world.onChange hook: queue checks for the block and its neighbours.
  changed(world, x, y, z, old, id) {
    if (world !== this.world) return;
    const oldDef = BLOCKS[old];
    if (oldDef.entity && BLOCKS[id].entity !== oldDef.entity) world.blockEntities.delete(`${x},${y},${z}`);
    for (const [dx, dy, dz] of NEIGHBOURS) this.queue.push(x + dx, y + dy, z + dz);
  }

  // Run queued neighbour updates (bounded so a cascade can't freeze a frame).
  process(limit = 4000) {
    let n = 0;
    while (this.queue.length && n < limit) {
      const z = this.queue.pop();
      const y = this.queue.pop();
      const x = this.queue.pop();
      this.neighbourUpdate(x, y, z);
      n++;
    }
  }

  neighbourUpdate(x, y, z) {
    const world = this.world;
    if (y < 0 || y >= HEIGHT || !world.isLoaded(x, z)) return;
    const id = world.getBlock(x, y, z);
    if (id === B.AIR) return;
    const def = BLOCKS[id];
    const game = this.game;
    if (FLUID[id]) {
      world.schedule(x, y, z, game.tickCount + this.fluidDelay(FLUID[id]));
      return;
    }
    if (!this.supported(x, y, z, id, def)) {
      game.breakNaturally(x, y, z);
      return;
    }
    if (FALLS[id]) this.fall(x, y, z, id);
    else if (def.portal === 'nether' && !this.portalIntact(x, y, z, id)) world.setBlock(x, y, z, B.AIR);
    else if (id === B.FARMLAND && SOLID[world.getBlock(x, y + 1, z)]) world.setBlock(x, y, z, B.DIRT);
  }

  supported(x, y, z, id, def) {
    const world = this.world;
    const below = world.getBlock(x, y - 1, z, B.BEDROCK);
    if (PLANT[id]) {
      if (def.cane) return below === B.SUGAR_CANE || canSupportPlant(id, below);
      return canSupportPlant(id, below);
    }
    if (id === B.CACTUS) {
      if (below !== B.SAND && below !== B.CACTUS) return false;
      return SIDES.every(([dx, , dz]) => !SOLID[world.getBlock(x + dx, y, z + dz)]);
    }
    if (id === B.FIRE) return SOLID[below] === 1 || world.dimension === 'nether';
    if (def.needsSupport === 'below') return SOLID[below] === 1;
    if (def.needsSupport === 'behind') {
      const [dx, dz] = FACING_DIR[def.facing];
      return SOLID[world.getBlock(x - dx, y, z - dz, B.BEDROCK)] === 1 && OPAQUE[world.getBlock(x - dx, y, z - dz, B.BEDROCK)] === 1;
    }
    if (def.door) {
      if (def.door.half === 'lower') return SOLID[below] === 1 && BLOCKS[world.getBlock(x, y + 1, z)].door?.half === 'upper';
      return BLOCKS[below].door?.half === 'lower';
    }
    if (def.bed) {
      const [dx, dz] = FACING_DIR[def.facing];
      const s = def.bed === 'foot' ? 1 : -1;
      return BLOCKS[world.getBlock(x + dx * s, y, z + dz * s)].bed === (def.bed === 'foot' ? 'head' : 'foot');
    }
    return true;
  }

  fall(x, y, z, id) {
    const world = this.world;
    let to = y;
    while (to > 0) {
      const below = world.getBlock(x, to - 1, z, B.BEDROCK);
      if (below !== B.AIR && !FLUID[below] && !PLANT[below] && below !== B.FIRE) break;
      to--;
    }
    if (to === y) return;
    world.setBlock(x, y, z, B.AIR);
    world.setBlock(x, to, z, id);
  }

  // A portal block needs portal or obsidian above, below and along its plane.
  portalIntact(x, y, z, id) {
    const world = this.world;
    const ok = (bx, by, bz) => {
      const n = world.getBlock(bx, by, bz, B.OBSIDIAN);
      return n === id || n === B.OBSIDIAN;
    };
    const along = id === B.NETHER_PORTAL_X ? [1, 0] : [0, 1];
    return ok(x, y + 1, z) && ok(x, y - 1, z) && ok(x + along[0], y, z + along[1]) && ok(x - along[0], y, z - along[1]);
  }

  // ---- Fluids ----
  fluidDelay(type) {
    if (type === 1) return 5;
    return this.world.dimension === 'nether' ? 10 : 30;
  }

  runScheduled() {
    const world = this.world;
    const now = this.game.tickCount;
    const due = [];
    for (const [key, tick] of world.scheduled) {
      if (tick <= now) due.push(key);
      if (due.length >= 1500) break;
    }
    for (const key of due) {
      world.scheduled.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      if (world.isLoaded(x, z)) this.fluidTick(x, y, z);
    }
  }

  canFlowInto(id) {
    return id === B.AIR || id === B.FIRE || (PLANT[id] && !FLUID[id]) || BLOCKS[id].needsSupport !== undefined && !SOLID[id];
  }

  flowInto(x, y, z, type, level) {
    const world = this.world;
    const cur = world.getBlock(x, y, z);
    if (cur !== B.AIR && !FLUID[cur] && cur !== B.FIRE) this.game.breakNaturally(x, y, z);
    world.setBlock(x, y, z, fluidBlock(type, level));
  }

  // Where lava meets water: obsidian from still lava, cobblestone from flowing lava.
  harden(x, y, z, lavaId) {
    const world = this.world;
    world.setBlock(x, y, z, FLUID_LEVEL[lavaId] === 0 ? B.OBSIDIAN : B.COBBLESTONE);
    this.game.sound('fizz', [x + 0.5, y + 0.5, z + 0.5]);
    this.game.particles.burst([x + 0.5, y + 1, z + 0.5], 'smoke', 6, 0.4);
  }

  fluidTick(x, y, z) {
    const world = this.world;
    const id = world.getBlock(x, y, z, B.BEDROCK);
    const type = FLUID[id];
    if (!type) return;
    const level = FLUID_LEVEL[id];
    const drop = type === 1 ? 1 : world.dimension === 'nether' ? 1 : 2;
    const get = (bx, by, bz) => world.getBlock(bx, by, bz, B.BEDROCK);

    if (type === 2) {
      for (const [dx, dy, dz] of [...SIDES, [0, 1, 0]]) {
        if (FLUID[get(x + dx, y + dy, z + dz)] === 1) {
          this.harden(x, y, z, id);
          return;
        }
      }
    }
    if (type === 1 && world.dimension === 'nether') {
      world.setBlock(x, y, z, B.AIR);
      return;
    }

    if (level !== 0) {
      let next;
      const falling = FLUID[get(x, y + 1, z)] === type;
      if (falling) {
        next = 8;
      } else {
        let best = 99;
        let sources = 0;
        for (const [dx, , dz] of SIDES) {
          const n = get(x + dx, y, z + dz);
          if (FLUID[n] !== type) continue;
          const l = FLUID_LEVEL[n];
          if (l === 0) sources++;
          best = Math.min(best, l === 8 ? 0 : l);
        }
        const below = get(x, y - 1, z);
        if (type === 1 && sources >= 2 && (SOLID[below] || (FLUID[below] === 1 && FLUID_LEVEL[below] === 0))) next = 0;
        else next = best + drop;
      }
      // A level past 7 means nothing feeds this cell any more (8 only ever means "falling").
      if (!falling && next > 7) {
        world.setBlock(x, y, z, B.AIR);
        return;
      }
      if (next !== level) {
        world.setBlock(x, y, z, fluidBlock(type, next));
        return;
      }
    }

    const below = get(x, y - 1, z);
    if (y > 0 && this.canFlowInto(below)) {
      this.flowInto(x, y - 1, z, type, 8);
      return;
    }
    if (FLUID[below] && FLUID[below] !== type) {
      // Water falling onto lava turns it to stone; lava falling onto water makes stone too.
      world.setBlock(x, y - 1, z, type === 1 && FLUID_LEVEL[below] === 0 ? B.OBSIDIAN : B.STONE);
      this.game.sound('fizz', [x + 0.5, y, z + 0.5]);
      return;
    }
    if (FLUID[below] === type && FLUID_LEVEL[below] !== 0) return;
    const spread = (level === 8 ? 0 : level) + drop;
    if (spread > 7) return;
    for (const [dx, , dz] of SIDES) {
      const nx = x + dx;
      const nz = z + dz;
      if (!world.isLoaded(nx, nz)) continue;
      const n = get(nx, y, nz);
      // Existing fluid of the same kind settles its own level on its next tick.
      if (FLUID[n] === type) continue;
      if (FLUID[n]) {
        if (type === 2) world.setBlock(nx, y, nz, B.COBBLESTONE);
        else if (FLUID_LEVEL[n] === 0) world.setBlock(nx, y, nz, B.OBSIDIAN);
        else world.setBlock(nx, y, nz, B.COBBLESTONE);
      } else if (this.canFlowInto(n)) {
        this.flowInto(nx, y, nz, type, spread);
      }
    }
  }

  // ---- Random ticks ----
  randomTicks(radius = 6) {
    const world = this.world;
    const game = this.game;
    const p = game.player.pos;
    const pcx = Math.floor(p[0] / CHUNK);
    const pcz = Math.floor(p[2] / CHUNK);
    for (const c of world.chunks.values()) {
      if (!c.blocks || Math.abs(c.cx - pcx) > radius || Math.abs(c.cz - pcz) > radius) continue;
      for (let i = 0; i < 24; i++) {
        const lx = (Math.random() * CHUNK) | 0;
        const lz = (Math.random() * CHUNK) | 0;
        const y = (Math.random() * HEIGHT) | 0;
        const id = c.blocks[blockIndex(lx, y, lz)];
        if (id === B.AIR || id === B.STONE || id === B.DIRT) continue;
        this.randomTick(c.cx * CHUNK + lx, y, c.cz * CHUNK + lz, id, c);
      }
    }
  }

  randomTick(x, y, z, id, chunk) {
    const world = this.world;
    const game = this.game;
    const def = BLOCKS[id];
    const light = () => game.lightAt(x, y + 1, z);
    if (id === B.GRASS) {
      const above = world.getBlock(x, y + 1, z);
      if (OPAQUE[above] || FLUID[above]) {
        world.setBlock(x, y, z, B.DIRT);
        return;
      }
      const tx = x + Math.floor(Math.random() * 3) - 1;
      const ty = y + Math.floor(Math.random() * 5) - 3;
      const tz = z + Math.floor(Math.random() * 3) - 1;
      if (world.getBlock(tx, ty, tz) === B.DIRT && !OPAQUE[world.getBlock(tx, ty + 1, tz)] && !FLUID[world.getBlock(tx, ty + 1, tz)] && game.lightAt(tx, ty + 1, tz) >= 9) {
        world.setBlock(tx, ty, tz, B.GRASS);
      }
    } else if (def.crop !== undefined && def.crop < 7) {
      if (light() >= 9 && Math.random() < 0.35) world.setBlock(x, y, z, B[`WHEAT_${def.crop + 1}`]);
    } else if (def.sapling) {
      if (light() >= 9 && Math.random() < 0.15) this.growTree(x, y, z, def.sapling);
    } else if (id === B.SUGAR_CANE || id === B.CACTUS) {
      let h = 1;
      while (h < 4 && world.getBlock(x, y - h, z) === id) h++;
      if (h < 3 && world.getBlock(x, y + 1, z) === B.AIR && Math.random() < 0.15) world.setBlock(x, y + 1, z, id);
    } else if (id === B.FIRE) {
      const rained = game.weather?.wet(world, x + 0.5, y + 0.5, z + 0.5);
      if ((world.getBlock(x, y - 1, z) !== B.NETHERRACK || rained) && Math.random() < (rained ? 0.9 : 0.4)) world.setBlock(x, y, z, B.AIR);
    } else if (id === B.FARMLAND) {
      const rained = game.weather?.wet(world, x + 0.5, y + 1.5, z + 0.5);
      if (!rained && !this.waterNear(x, y, z) && !BLOCKS[world.getBlock(x, y + 1, z)].crop && Math.random() < 0.2) world.setBlock(x, y, z, B.DIRT);
    } else if (LEAVES[id]) {
      const i = blockIndex(x - chunk.cx * CHUNK, y, z - chunk.cz * CHUNK);
      if (world.edits.get(chunk.key)?.get(i) === id) return; // placed by the player: stays
      if (!this.logNear(x, y, z)) game.breakNaturally(x, y, z);
    }
  }

  waterNear(x, y, z) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = 0; dy <= 1; dy++) if (FLUID[this.world.getBlock(x + dx, y + dy, z + dz)] === 1) return true;
      }
    }
    return false;
  }

  logNear(x, y, z) {
    const logs = [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 5) continue;
          if (logs.includes(this.world.getBlock(x + dx, y + dy, z + dz, B.OAK_LOG))) return true;
        }
      }
    }
    return false;
  }

  // Saplings grow into the same trees world generation makes.
  growTree(x, y, z, kind) {
    const world = this.world;
    const trunk = kind === 'spruce' ? 6 + Math.floor(Math.random() * 3) : kind === 'birch' ? 5 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 2);
    for (let k = 1; k <= trunk + 1; k++) {
      const id = world.getBlock(x, y + k, z);
      if (id !== B.AIR && !LEAVES[id]) return false;
    }
    const set = (bx, by, bz, id, isTrunk) => {
      const cur = world.getBlock(bx, by, bz);
      if (cur === B.AIR || (PLANT[cur] && !(bx === x && by === y && bz === z)) || (isTrunk && (LEAVES[cur] || (bx === x && bz === z)))) world.setBlock(bx, by, bz, id);
    };
    world.setBlock(x, y, z, B.AIR);
    if (kind === 'spruce') spruceTree(set, x, y - 1, z, trunk);
    else if (kind === 'birch') broadleafTree(set, x, y - 1, z, trunk, B.BIRCH_LOG, B.BIRCH_LEAVES, 1234);
    else broadleafTree(set, x, y - 1, z, trunk, B.OAK_LOG, B.OAK_LEAVES, 1234);
    return true;
  }
}
