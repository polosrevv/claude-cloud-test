// Villages: a well in the middle, gravel roads running out from it, and
// houses, a library, a blacksmith, farms and lamp posts along the roads.
// Like every other structure it is a pure function of the seed: each village
// is laid out once, then clipped to whichever chunk is being generated. Every
// building levels itself onto the ground under its own centre.
import { B, facingBlock } from './blocks.js';
import { hash2, mulberry32 } from './noise.js';
import { SEA_LEVEL, HEIGHT } from './constants.js';

export const VILLAGE_CELL = 384;
const REACH = 52; // furthest any block of a village lies from its well

// Building footprints in local space: lx across the front, lz back from the road.
const SIZES = { house: [5, 5], big_house: [7, 6], library: [7, 6], smith: [7, 6], farm: [7, 9], lamp: [1, 1] };

// Materials per biome: [wall, floor/foundation, corner post, roof]
function palette(biome) {
  if (biome === 'desert') return { wall: B.SANDSTONE, floor: B.SANDSTONE, post: B.SANDSTONE, roof: B.SANDSTONE, road: B.SANDSTONE, stairs: 'sandstone_stairs' };
  if (biome === 'tundra') return { wall: B.SPRUCE_PLANKS, floor: B.COBBLESTONE, post: B.SPRUCE_LOG, roof: B.SPRUCE_PLANKS, road: B.GRAVEL, stairs: 'cobblestone_stairs' };
  return { wall: B.PLANKS, floor: B.COBBLESTONE, post: B.OAK_LOG, roof: B.PLANKS, road: B.GRAVEL, stairs: 'oak_stairs' };
}

export function createVillages(seed, column, biomeKind) {
  const cache = new Map();
  const vseed = seed ^ 0x7111;

  function villageIn(gx, gz) {
    const key = `${gx},${gz}`;
    if (cache.has(key)) return cache.get(key);
    let v = null;
    if (hash2(gx, gz, vseed) < 0.6) {
      const x = gx * VILLAGE_CELL + 64 + Math.floor(hash2(gx, gz, vseed + 1) * (VILLAGE_CELL - 128));
      const z = gz * VILLAGE_CELL + 64 + Math.floor(hash2(gx, gz, vseed + 2) * (VILLAGE_CELL - 128));
      const info = column(x, z, {});
      const kind = biomeKind(info.biome);
      let flat = info.h > SEA_LEVEL + 1 && info.h < HEIGHT - 30;
      for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) {
        const h = column(x + dx, z + dz, {}).h;
        if (Math.abs(h - info.h) > 4 || h <= SEA_LEVEL) flat = false;
      }
      if (kind && flat) v = layout(x, z, info.h, kind, mulberry32(Math.floor(hash2(gx, gz, vseed + 3) * 4294967296)));
    }
    cache.set(key, v);
    return v;
  }

  // Villages whose area touches the box [x0, x1] x [z0, z1].
  function near(x0, z0, x1, z1) {
    const out = [];
    for (let gz = Math.floor((z0 - REACH) / VILLAGE_CELL); gz <= Math.floor((z1 + REACH) / VILLAGE_CELL); gz++) {
      for (let gx = Math.floor((x0 - REACH) / VILLAGE_CELL); gx <= Math.floor((x1 + REACH) / VILLAGE_CELL); gx++) {
        const v = villageIn(gx, gz);
        if (v && v.x + REACH >= x0 && v.x - REACH <= x1 && v.z + REACH >= z0 && v.z - REACH <= z1) out.push(v);
      }
    }
    return out;
  }

  function layout(x, z, y, biome, r) {
    const v = { x, z, y, biome, roads: [], buildings: [] };
    const taken = [[x - 3, z - 3, x + 3, z + 3]];
    const free = (a) => taken.every((b) => a[2] + 1 < b[0] || a[0] - 1 > b[2] || a[3] + 1 < b[1] || a[1] - 1 > b[3]);
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const made = { library: 0, smith: 0 };
    dirs.forEach(([dx, dz], d) => {
      if (d > 1 && r() < 0.25) return;
      const len = 16 + Math.floor(r() * 16);
      v.roads.push({ dx, dz, len });
      // Lots on both sides of the road, every 9 to 11 blocks.
      for (let along = 5; along < len - 2; along += 9 + Math.floor(r() * 3)) {
        for (const side of [-1, 1]) {
          if (r() < 0.25) continue;
          let type = r() < 0.4 ? 'house' : r() < 0.5 ? 'big_house' : r() < 0.55 ? 'farm' : 'lamp';
          if (type === 'big_house' && !made.library && r() < 0.5) type = 'library';
          else if (type === 'big_house' && !made.smith && r() < 0.5) type = 'smith';
          if (type === 'library' || type === 'smith') made[type]++;
          const [w, depth] = SIZES[type];
          // The building's front faces the road; local x runs along it.
          const px = -dz * side;
          const pz = dx * side;
          const front = 3;
          const cxw = x + dx * along + px * front;
          const czw = z + dz * along + pz * front;
          // Facing (n e s w) from the building toward the road.
          const facing = dirs.findIndex(([fx, fz]) => fx === -px && fz === -pz);
          const b = place(type, facing, cxw, czw, w, depth);
          if (!free(b.rect)) continue;
          taken.push(b.rect);
          b.y = column(Math.floor((b.rect[0] + b.rect[2]) / 2), Math.floor((b.rect[1] + b.rect[3]) / 2), {}).h;
          if (b.y <= SEA_LEVEL) continue;
          b.seed = Math.floor(r() * 1e9);
          v.buildings.push(b);
        }
      }
    });
    return v;
  }

  // Local (lx, lz) -> world, with local (0, 0) the front-left corner by the road.
  function place(type, facing, fx, fz, w, d) {
    const half = Math.floor(w / 2);
    let ox;
    let oz;
    let toWorld;
    switch (facing) {
      case 0: ox = fx - half; oz = fz; toWorld = (lx, lz) => [ox + lx, oz + lz]; break; // road to the north
      case 2: ox = fx + half; oz = fz; toWorld = (lx, lz) => [ox - lx, oz - lz]; break; // road to the south
      case 1: ox = fx; oz = fz - half; toWorld = (lx, lz) => [ox - lz, oz + lx]; break; // road to the east
      default: ox = fx; oz = fz + half; toWorld = (lx, lz) => [ox + lz, oz - lx]; break; // road to the west
    }
    const a = toWorld(0, 0);
    const b = toWorld(w - 1, d - 1);
    return { type, facing, w, d, toWorld, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  }

  // Write a village's blocks; set() ignores anything outside the current chunk.
  function build(v, set, x0, z0, x1, z1) {
    const p = palette(v.biome);
    const inChunk = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    // Roads follow the ground; over water they become plank bridges.
    for (const road of v.roads) {
      for (let k = 3; k <= road.len; k++) {
        for (let s = -1; s <= 1; s++) {
          const x = v.x + road.dx * k - road.dz * s;
          const z = v.z + road.dz * k + road.dx * s;
          if (!inChunk(x, z)) continue;
          const h = column(x, z, {}).h;
          if (h < SEA_LEVEL) set(x, SEA_LEVEL, z, B.PLANKS);
          else {
            set(x, h, z, p.road);
            set(x, h + 1, z, B.AIR);
            set(x, h + 2, z, B.AIR);
          }
        }
      }
    }
    well(v, set, p, inChunk);
    for (const b of v.buildings) {
      if (b.rect[2] < x0 - 1 || b.rect[0] > x1 + 1 || b.rect[3] < z0 - 1 || b.rect[1] > z1 + 1) continue;
      building(b, set, p, inChunk);
    }
  }

  // A cobblestone well: a ring of stone around deep water, fence posts and a roof.
  function well(v, set, p, inChunk) {
    const y = v.y;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = v.x + dx;
        const z = v.z + dz;
        if (!inChunk(x, z)) continue;
        const h = column(x, z, {}).h;
        for (let yy = h + 1; yy < y; yy++) set(x, yy, z, B.COBBLESTONE);
        for (let yy = y + 1; yy <= y + 6; yy++) set(x, yy, z, B.AIR);
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring === 2) {
          set(x, y, z, p.road);
        } else if (ring === 0) {
          for (let k = 0; k < 3; k++) set(x, y - k, z, B.WATER);
          set(x, y - 3, z, B.COBBLESTONE);
        } else {
          for (let yy = y - 3; yy <= y + 1; yy++) set(x, yy, z, B.COBBLESTONE);
          if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
            set(x, y + 2, z, B.OAK_FENCE);
            set(x, y + 3, z, B.OAK_FENCE);
          }
        }
        if (ring <= 1) set(x, y + 4, z, B.COBBLESTONE);
      }
    }
  }

  function building(b, set, p, inChunk) {
    const r = mulberry32(b.seed);
    const y = b.y;
    const { w, d } = b;
    const put = (lx, ly, lz, id) => {
      const [x, z] = b.toWorld(lx, lz);
      if (inChunk(x, z)) set(x, y + ly, z, id);
    };
    // Level the plot: fill dips with foundation, clear hills and trees above.
    for (let lz = 0; lz < d; lz++) {
      for (let lx = 0; lx < w; lx++) {
        const [x, z] = b.toWorld(lx, lz);
        if (!inChunk(x, z)) continue;
        const h = column(x, z, {}).h;
        for (let yy = Math.min(h + 1, y); yy < y; yy++) set(x, yy, z, b.type === 'farm' ? B.DIRT : p.floor);
        for (let yy = y + 1; yy <= y + 9; yy++) set(x, yy, z, B.AIR);
        set(x, y, z, b.type === 'farm' || b.type === 'lamp' ? B.GRASS : p.floor);
      }
    }
    const inward = (b.facing + 2) % 4;
    const wallsAndRoof = (height) => {
      for (let lz = 0; lz < d; lz++) {
        for (let lx = 0; lx < w; lx++) {
          const edgeX = lx === 0 || lx === w - 1;
          const edgeZ = lz === 0 || lz === d - 1;
          if (!edgeX && !edgeZ) continue;
          for (let ly = 1; ly <= height; ly++) put(lx, ly, lz, edgeX && edgeZ ? p.post : p.wall);
        }
      }
      for (let lz = 0; lz < d; lz++) for (let lx = 0; lx < w; lx++) put(lx, height + 1, lz, p.roof);
      // A trim of slabs or stairs keeps the roof from looking like a box lid.
      for (let lx = 0; lx < w; lx++) {
        put(lx, height + 2, 0, facingBlock(p.stairs, inward));
        put(lx, height + 2, d - 1, facingBlock(p.stairs, b.facing));
      }
      for (let lz = 1; lz < d - 1; lz++) for (let lx = 0; lx < w; lx++) put(lx, height + 2, lz, p.roof);
      // Windows on the sides and back.
      put(0, 2, Math.floor(d / 2), B.GLASS_PANE);
      put(w - 1, 2, Math.floor(d / 2), B.GLASS_PANE);
      put(Math.floor(w / 2), 2, d - 1, B.GLASS_PANE);
      // The door, facing in from the road.
      const door = Math.floor(w / 2);
      put(door, 1, 0, facingBlock('oak_door_lower', inward));
      put(door, 2, 0, facingBlock('oak_door_upper', inward));
      // A step up to it.
      const [sx, sz] = b.toWorld(door, -1);
      if (inChunk(sx, sz)) {
        set(sx, y, sz, facingBlock(p.stairs, inward));
        set(sx, y + 1, sz, B.AIR);
        set(sx, y + 2, sz, B.AIR);
      }
      // A torch on the back wall, inside.
      put(door, 3, d - 2, facingBlock('wall_torch', b.facing));
    };
    switch (b.type) {
      case 'house':
        wallsAndRoof(3);
        put(1, 1, d - 2, B.CRAFTING_TABLE);
        break;
      case 'big_house':
        wallsAndRoof(4);
        put(1, 1, d - 2, facingBlock('bed_foot', b.facing));
        put(1, 1, d - 3, facingBlock('bed_head', b.facing));
        put(w - 2, 1, d - 2, B.CRAFTING_TABLE);
        put(w - 2, 1, 1, B.OAK_FENCE);
        put(w - 2, 2, 1, B.STONE_SLAB);
        break;
      case 'library':
        wallsAndRoof(4);
        for (let lx = 1; lx < w - 1; lx++) {
          put(lx, 1, d - 2, B.BOOKSHELF);
          put(lx, 2, d - 2, B.BOOKSHELF);
        }
        put(w - 2, 1, 1, B.CRAFTING_TABLE);
        break;
      case 'smith': {
        const saved = { ...p };
        p.wall = B.COBBLESTONE;
        p.post = B.COBBLESTONE;
        wallsAndRoof(4);
        Object.assign(p, saved);
        put(1, 1, d - 2, facingBlock('furnace', b.facing));
        put(2, 1, d - 2, facingBlock('furnace', b.facing));
        put(w - 2, 1, d - 2, facingBlock('chest', b.facing));
        put(w - 1, 2, Math.floor(d / 2), B.IRON_BARS);
        break;
      }
      case 'farm':
        for (let lz = 0; lz < d; lz++) {
          for (let lx = 0; lx < w; lx++) {
            const edge = lx === 0 || lx === w - 1 || lz === 0 || lz === d - 1;
            if (edge) put(lx, 0, lz, B.OAK_LOG);
            else if (lx === 3) put(lx, 0, lz, B.WATER);
            else {
              put(lx, 0, lz, B.FARMLAND);
              const crop = r();
              put(lx, 1, lz, crop < 0.1 ? B.PUMPKIN_STEM_7 : crop < 0.15 ? B.MELON_STEM_5 : B[`WHEAT_${2 + Math.floor(r() * 6)}`]);
            }
          }
        }
        break;
      case 'lamp':
        put(0, 1, 0, B.OAK_FENCE);
        put(0, 2, 0, B.OAK_FENCE);
        put(0, 3, 0, B.WOOL_BLACK);
        for (let f = 0; f < 4; f++) {
          const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
          const [x, z] = b.toWorld(0, 0);
          if (inChunk(x + dx, z + dz)) set(x + dx, y + 3, z + dz, facingBlock('wall_torch', f));
        }
        break;
      default:
        break;
    }
  }

  // Who lives where: one villager per house (by trade), plus an iron golem at the well.
  function residents(v) {
    const out = [{ type: 'iron_golem', x: v.x + 3.5, y: v.y + 1, z: v.z + 0.5 }];
    for (const b of v.buildings) {
      if (b.type === 'farm' || b.type === 'lamp') continue;
      const [x, z] = b.toWorld(Math.floor(b.w / 2), Math.floor(b.d / 2));
      const profession = { library: 'librarian', smith: 'smith' }[b.type] ?? ['farmer', 'farmer', 'butcher', 'priest'][b.seed % 4];
      out.push({ type: 'villager', profession, x: x + 0.5, y: b.y + 1, z: z + 0.5 });
      if (b.type === 'big_house') out.push({ type: 'villager', profession: 'farmer', x: x + 0.5, y: b.y + 1, z: z + 1.5 });
    }
    return out;
  }

  // Is (x, z) inside a village's built-up area (roads, plots and a margin)?
  function covers(x, z) {
    for (const v of near(x, z, x, z)) {
      if (Math.hypot(x - v.x, z - v.z) < 6) return true;
      for (const b of v.buildings) if (x >= b.rect[0] - 3 && x <= b.rect[2] + 3 && z >= b.rect[1] - 3 && z <= b.rect[3] + 3) return true;
      for (const r of v.roads) {
        const along = (x - v.x) * r.dx + (z - v.z) * r.dz;
        const across = Math.abs((x - v.x) * -r.dz + (z - v.z) * r.dx);
        if (along >= 0 && along <= r.len + 2 && across <= 4) return true;
      }
    }
    return false;
  }

  function insideBuilding(v, x, y, z) {
    return v.buildings.some((b) => x >= b.rect[0] && x <= b.rect[2] && z >= b.rect[1] && z <= b.rect[3] && y >= b.y && y <= b.y + 8);
  }

  return { villageIn, near, build, residents, insideBuilding, covers };
}
