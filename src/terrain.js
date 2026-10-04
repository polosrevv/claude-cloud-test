// Deterministic world generation. Every feature is a pure function of the
// seed and world coordinates, so a chunk can be generated in any order (and on
// any worker) and trees that straddle chunk borders still line up.
import { Simplex, mulberry32, hash2, hash3 } from './noise.js';
import { B, PLANT, LEAVES } from './blocks.js';
import { CHUNK, HEIGHT, SEA_LEVEL, blockIndex } from './constants.js';
import { broadleafTree, spruceTree, strongholdRoom, STRONGHOLD_SIZE, dungeon, DUNGEON_SIZE } from './structures.js';
import { createNether } from './nether.js';
import { createEnd } from './end.js';
import { createVillages, VILLAGE_CELL } from './village.js';

export { CHUNK, HEIGHT, SEA_LEVEL, blockIndex };

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TUNDRA: 5, MOUNTAINS: 6, PEAKS: 7 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy Tundra', 'Mountains', 'Snowy Peaks'];

// Chance that a 5x5 tree cell actually grows a tree, per biome.
const TREE_DENSITY = [0, 0, 0.05, 0.72, 0.14, 0.3, 0.12, 0];
const TREE_CELL = 5;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const DIMENSIONS = {
  overworld: { name: 'Overworld', sky: true, skyLight: 15 },
  nether: { name: 'The Nether', sky: false, skyLight: 0, scale: 8 },
  end: { name: 'The End', sky: false, skyLight: 0 },
};

export function createTerrain(seed, dimension = 'overworld') {
  if (dimension === 'nether') return createNether(seed);
  if (dimension === 'end') return createEnd(seed);
  return createOverworld(seed);
}

function createOverworld(seed) {
  const rnd = mulberry32(seed);
  const continent = new Simplex(rnd);
  const hills = new Simplex(rnd);
  const roughness = new Simplex(rnd);
  const detail = new Simplex(rnd);
  const mountain = new Simplex(rnd);
  const ridge = new Simplex(rnd);
  const temperature = new Simplex(rnd);
  const humidity = new Simplex(rnd);
  const caveA = new Simplex(rnd);
  const caveB = new Simplex(rnd);
  const cavern = new Simplex(rnd);
  const treeSeed = seed ^ 0x2545f491;
  const plantSeed = seed ^ 0x68e31da4;
  const bedrockSeed = seed ^ 0x1b56c4e9;

  // Height, biome and a little local noise for one column. Writes into `out`
  // to avoid allocating in the hot loop.
  function column(x, z, out) {
    const c = continent.fbm2(x / 520, z / 520, 4);
    const rough = roughness.fbm2(x / 300, z / 300, 2) * 0.5 + 0.5;
    const hl = hills.fbm2(x / 150, z / 150, 4);
    const d = detail.noise2(x / 28, z / 28);
    const m = smoothstep(0.12, 0.5, mountain.fbm2(x / 640, z / 640, 3)) * smoothstep(-0.15, 0.1, c);
    const rg = 1 - Math.abs(ridge.fbm2(x / 170, z / 170, 4));
    let h = SEA_LEVEL + 4 + c * 30 + hl * (3 + 11 * rough) + d * 1.6 + m * (rg * rg * 52 + 6);
    h = Math.max(6, Math.min(HEIGHT - 12, Math.floor(h)));
    const t = temperature.fbm2(x / 900, z / 900, 3);
    const w = humidity.fbm2(x / 720, z / 720, 3);
    let biome;
    if (h < SEA_LEVEL - 2) biome = BIOME.OCEAN;
    else if (h <= SEA_LEVEL + 1 && m < 0.3) biome = BIOME.BEACH;
    else if (h > 94 + d * 4) biome = BIOME.PEAKS;
    else if (m > 0.35 && h > 78) biome = BIOME.MOUNTAINS;
    else if (t > 0.22 && w < 0.08) biome = BIOME.DESERT;
    else if (t < -0.28) biome = BIOME.TUNDRA;
    else if (w > 0.1) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    out.h = h;
    out.biome = biome;
    out.detail = d;
    out.temperature = t;
    return out;
  }

  function surface(info, x, z) {
    const d = info.detail;
    switch (info.biome) {
      case BIOME.OCEAN: {
        const r = hash2(x >> 2, z >> 2, plantSeed);
        return { top: r < 0.2 ? B.GRAVEL : r < 0.3 ? B.DIRT : B.SAND, filler: B.SAND, depth: 3 };
      }
      case BIOME.BEACH: return { top: info.temperature < -0.28 ? B.GRAVEL : B.SAND, filler: B.SAND, depth: 4 };
      case BIOME.DESERT: return { top: B.SAND, filler: B.SAND, depth: 4 };
      case BIOME.PEAKS: return { top: B.SNOW, filler: B.STONE, depth: 1 };
      case BIOME.MOUNTAINS:
        if (d > 0.2) return { top: info.h > 86 ? B.SNOWY_GRASS : B.GRASS, filler: B.DIRT, depth: 2 };
        if (d < -0.45) return { top: B.GRAVEL, filler: B.GRAVEL, depth: 2 };
        return { top: B.STONE, filler: B.STONE, depth: 1 };
      case BIOME.TUNDRA: return { top: B.SNOWY_GRASS, filler: B.DIRT, depth: 3 };
      default: return { top: B.GRASS, filler: B.DIRT, depth: 3 };
    }
  }

  // Worm-like tunnels everywhere below ground plus big caverns deeper down.
  function isCave(x, y, z, h) {
    if (y < 5) return false;
    const a = caveA.noise3(x / 46, y / 30, z / 46);
    const b = caveB.noise3(x / 46, y / 30, z / 46);
    if (a * a + b * b < 0.006) return true;
    if (y < h - 7) {
      const c = cavern.noise3(x / 72, y / 36, z / 72);
      if (c > (y < 24 ? 0.58 : 0.64)) return true;
    }
    return false;
  }

  function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const heights = new Int16Array(CHUNK * CHUNK);
    const biomes = new Uint8Array(CHUNK * CHUNK);
    const info = {};
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        column(wx, wz, info);
        const h = info.h;
        heights[lz * CHUNK + lx] = h;
        biomes[lz * CHUNK + lx] = info.biome;
        const s = surface(info, wx, wz);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y < 4 && hash3(wx, y, wz, bedrockSeed) < (4 - y) * 0.25)) id = B.BEDROCK;
          else if (y === h) id = s.top;
          else if (y > h - s.depth) id = s.filler;
          else if (info.biome === BIOME.DESERT && y > h - s.depth - 4) id = B.SANDSTONE;
          else id = B.STONE;
          data[blockIndex(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) data[blockIndex(lx, y, lz)] = B.WATER;

        // Keep sea and lake floors sealed so caves never drain into the ocean.
        const top = h < SEA_LEVEL + 2 ? h - 5 : h;
        for (let y = 5; y <= top; y++) {
          const i = blockIndex(lx, y, lz);
          // Deep caves flood with lava, as they do in Minecraft.
          if (data[i] !== B.BEDROCK && isCave(wx, y, wz, h)) data[i] = y <= 10 ? B.LAVA : B.AIR;
        }

        // Frozen lakes and seas in cold places; clay on shallow sea beds.
        if (h < SEA_LEVEL && info.temperature < -0.28) data[blockIndex(lx, SEA_LEVEL, lz)] = B.ICE;
        if (h < SEA_LEVEL - 1 && h >= SEA_LEVEL - 7 && hash2(wx >> 2, wz >> 2, plantSeed ^ 0x1234) < 0.18) {
          data[blockIndex(lx, h, lz)] = B.CLAY;
        }
      }
    }

    addOres(data, cx, cz);
    addPlants(data, heights, biomes, x0, z0);
    addSugarCane(data, heights, x0, z0);
    addTrees(data, x0, z0, info);
    addStructures(data, x0, z0);
    return data;
  }

  // Sugar cane grows on shore blocks right next to water.
  function addSugarCane(data, heights, x0, z0) {
    const near = {};
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const h = heights[lz * CHUNK + lx];
        if (h !== SEA_LEVEL && h !== SEA_LEVEL + 1) continue;
        const wx = x0 + lx;
        const wz = z0 + lz;
        if (hash2(wx, wz, plantSeed ^ 0x77) > 0.22) continue;
        const ground = data[blockIndex(lx, h, lz)];
        if (ground !== B.GRASS && ground !== B.SAND && ground !== B.DIRT) continue;
        let wet = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (column(wx + dx, wz + dz, near).h < SEA_LEVEL) wet = true;
        }
        if (!wet) continue;
        const tall = 1 + Math.floor(hash2(wx, wz, plantSeed ^ 0x99) * 3);
        for (let k = 1; k <= tall; k++) {
          const i = blockIndex(lx, h + k, lz);
          if (data[i] !== B.AIR && !PLANT[data[i]]) break;
          data[i] = B.SUGAR_CANE;
        }
      }
    }
  }

  // ---- Structures ----
  const strongholdSeed = seed ^ 0x51a7;
  let strongholdList = null;
  // Three portal rooms in a ring around spawn, 520-760 blocks out.
  function strongholds() {
    if (!strongholdList) {
      strongholdList = [];
      const base = hash2(1, 2, strongholdSeed) * Math.PI * 2;
      for (let i = 0; i < 3; i++) {
        const a = base + (i * Math.PI * 2) / 3;
        const r = 520 + hash2(i, 7, strongholdSeed) * 240;
        const x = Math.floor(Math.cos(a) * r);
        const z = Math.floor(Math.sin(a) * r);
        strongholdList.push({ x, y: 20, z, centre: [x + 5.5, 21, z + 10.5] });
      }
    }
    return strongholdList;
  }

  const villages = createVillages(seed, column, (biome) => (biome === BIOME.PLAINS ? 'plains' : biome === BIOME.DESERT ? 'desert' : biome === BIOME.TUNDRA ? 'tundra' : null));

  // At most one dungeon per 48x48 area, buried well below the surface.
  const DUNGEON_CELL = 48;
  function dungeonIn(gx, gz) {
    if (hash2(gx, gz, seed ^ 0xd06) > 0.45) return null;
    const x = gx * DUNGEON_CELL + 4 + Math.floor(hash2(gx, gz, seed ^ 0xd07) * (DUNGEON_CELL - 16));
    const z = gz * DUNGEON_CELL + 4 + Math.floor(hash2(gx, gz, seed ^ 0xd08) * (DUNGEON_CELL - 16));
    const y = 12 + Math.floor(hash2(gx, gz, seed ^ 0xd09) * 24);
    const surface = column(x + 4, z + 4, {}).h;
    if (surface < y + 12) return null;
    return { x, y, z };
  }

  function addStructures(data, x0, z0) {
    const set = (x, y, z, id) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
      data[blockIndex(lx, y, lz)] = id;
    };
    const get = (x, y, z) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return null;
      return data[blockIndex(lx, y, lz)];
    };
    for (let gz = Math.floor((z0 - 16) / DUNGEON_CELL); gz <= Math.floor((z0 + CHUNK) / DUNGEON_CELL); gz++) {
      for (let gx = Math.floor((x0 - 16) / DUNGEON_CELL); gx <= Math.floor((x0 + CHUNK) / DUNGEON_CELL); gx++) {
        const d = dungeonIn(gx, gz);
        if (!d) continue;
        if (d.x + DUNGEON_SIZE[0] < x0 || d.x > x0 + CHUNK || d.z + DUNGEON_SIZE[2] < z0 || d.z > z0 + CHUNK) continue;
        dungeon(set, get, d.x, d.y, d.z, seed);
      }
    }
    for (const s of strongholds()) {
      if (s.x + STRONGHOLD_SIZE[0] < x0 || s.x > x0 + CHUNK || s.z + STRONGHOLD_SIZE[2] < z0 || s.z > z0 + CHUNK) continue;
      strongholdRoom(set, s.x, s.y, s.z, strongholdSeed);
    }
    for (const v of villages.near(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) villages.build(v, set, x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1);
  }

  // Villagers and golems that move in when a village chunk first loads.
  function residentsIn(cx, cz) {
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const out = [];
    for (const v of villages.near(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
      for (const r of villages.residents(v)) {
        if (r.x >= x0 && r.x < x0 + CHUNK && r.z >= z0 && r.z < z0 + CHUNK) out.push({ ...r, village: [v.x, v.y, v.z] });
      }
    }
    return out;
  }

  // Which loot table a generated chest at (x, y, z) belongs to.
  function chestLoot(x, y, z) {
    for (const v of villages.near(x, z, x, z)) if (villages.insideBuilding(v, x, y, z)) return 'village';
    for (const s of strongholds()) {
      if (x >= s.x && x < s.x + STRONGHOLD_SIZE[0] && z >= s.z && z < s.z + STRONGHOLD_SIZE[2] && y >= s.y && y < s.y + STRONGHOLD_SIZE[1]) return 'stronghold';
    }
    return 'dungeon';
  }

  function spawnerMob(x, y, z) {
    const r = hash3(x, y, z, seed ^ 0x5b);
    return r < 0.5 ? 'zombie' : r < 0.75 ? 'skeleton' : 'spider';
  }

  function locate(kind, x, z) {
    if (kind === 'village') {
      // Search outward ring by ring of village cells.
      const gx0 = Math.floor(x / VILLAGE_CELL);
      const gz0 = Math.floor(z / VILLAGE_CELL);
      let found = null;
      for (let ring = 0; ring < 8 && !found; ring++) {
        for (let gz = gz0 - ring; gz <= gz0 + ring; gz++) {
          for (let gx = gx0 - ring; gx <= gx0 + ring; gx++) {
            if (Math.max(Math.abs(gx - gx0), Math.abs(gz - gz0)) !== ring) continue;
            const v = villages.villageIn(gx, gz);
            if (!v) continue;
            const d = Math.hypot(v.x - x, v.z - z);
            if (!found || d < found.distance) found = { x: v.x, y: v.y, z: v.z, distance: d };
          }
        }
      }
      return found;
    }
    if (kind !== 'stronghold') return null;
    let best = null;
    for (const s of strongholds()) {
      const d = Math.hypot(s.centre[0] - x, s.centre[2] - z);
      if (!best || d < best.distance) best = { x: Math.floor(s.centre[0]), y: s.y + 1, z: Math.floor(s.centre[2]), distance: d };
    }
    return best;
  }

  function addOres(data, cx, cz) {
    const r = mulberry32(Math.floor(hash2(cx, cz, seed ^ 0x27d4eb2d) * 4294967296));
    const vein = (id, count, size, minY, maxY) => {
      for (let v = 0; v < count; v++) {
        let x = (r() * CHUNK) | 0;
        let y = minY + ((r() * (maxY - minY)) | 0);
        let z = (r() * CHUNK) | 0;
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
            const i = blockIndex(x, y, z);
            if (data[i] === B.STONE) data[i] = id;
          }
          const step = r() < 0.5 ? -1 : 1;
          const axis = (r() * 3) | 0;
          if (axis === 0) x += step; else if (axis === 1) y += step; else z += step;
        }
      }
    };
    vein(B.COAL_ORE, 16, 9, 6, 100);
    vein(B.IRON_ORE, 10, 6, 5, 64);
    vein(B.GOLD_ORE, 3, 6, 5, 32);
    vein(B.DIAMOND_ORE, r() < 0.6 ? 1 : 2, 5, 5, 16);
    vein(B.GRAVEL, 3, 18, 8, 90);
    vein(B.DIRT, 3, 18, 8, 90);
    // Added last so the veins above stay where they were in older worlds.
    if (r() < 0.8) vein(B.LAPIS_ORE, 1, 7, 5, 32);
    // Emeralds: single ores, only under the mountains.
    const biome = column(cx * CHUNK + 8, cz * CHUNK + 8, {}).biome;
    if (biome === BIOME.MOUNTAINS || biome === BIOME.PEAKS) vein(B.EMERALD_ORE, 3 + Math.floor(r() * 5), 1, 4, 32);
  }

  function addPlants(data, heights, biomes, x0, z0) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const h = heights[lz * CHUNK + lx];
        if (h + 1 >= HEIGHT || data[blockIndex(lx, h + 1, lz)] !== B.AIR) continue;
        const ground = data[blockIndex(lx, h, lz)];
        const biome = biomes[lz * CHUNK + lx];
        const p = hash2(x0 + lx, z0 + lz, plantSeed);
        let id = B.AIR;
        if (ground === B.GRASS) {
          if (biome === BIOME.PLAINS) id = p < 0.16 ? B.TALL_GRASS : p < 0.18 ? B.POPPY : p < 0.2 ? B.DANDELION : B.AIR;
          else if (biome === BIOME.FOREST) id = p < 0.08 ? B.TALL_GRASS : p < 0.09 ? B.POPPY : p < 0.1 ? B.DANDELION : p < 0.104 ? B.BROWN_MUSHROOM : p < 0.106 ? B.RED_MUSHROOM : B.AIR;
          else if (p < 0.06) id = B.TALL_GRASS;
          // Rare patches of pumpkins on grassland, and melons in the forest.
          if ((biome === BIOME.PLAINS || biome === BIOME.FOREST) && hash2((x0 + lx) >> 3, (z0 + lz) >> 3, plantSeed ^ 0x5eed) < 0.03 && p > 0.9) {
            id = biome === BIOME.FOREST && p > 0.97 ? B.MELON : B[`PUMPKIN_${'NESW'[Math.floor(p * 400) % 4]}`];
          }
        } else if (ground === B.SAND && biome === BIOME.DESERT && p < 0.012) {
          id = B.DEAD_BUSH;
        }
        if (id !== B.AIR) data[blockIndex(lx, h + 1, lz)] = id;
      }
    }
  }

  function addTrees(data, x0, z0, info) {
    // Trunks may replace air, plants and other trees' leaves; leaves only fill air and plants.
    const set = (x, y, z, id, trunk) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = blockIndex(lx, y, lz);
      const cur = data[i];
      if (cur === B.AIR || PLANT[cur] || (trunk && LEAVES[cur])) data[i] = id;
    };
    const gx0 = Math.floor((x0 - 6) / TREE_CELL);
    const gx1 = Math.floor((x0 + CHUNK + 5) / TREE_CELL);
    const gz0 = Math.floor((z0 - 6) / TREE_CELL);
    const gz1 = Math.floor((z0 + CHUNK + 5) / TREE_CELL);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const roll = hash2(gx, gz, treeSeed + 2);
        if (roll > 0.75) continue;
        const tx = gx * TREE_CELL + Math.floor(hash2(gx, gz, treeSeed) * 3);
        const tz = gz * TREE_CELL + Math.floor(hash2(gx, gz, treeSeed + 1) * 3);
        // Villages keep their streets and gardens clear of trees.
        if (villages.covers(tx, tz)) continue;
        column(tx, tz, info);
        if (roll >= TREE_DENSITY[info.biome] || info.h <= SEA_LEVEL || info.h + 12 >= HEIGHT) continue;
        const ground = surface(info, tx, tz).top;
        const desert = info.biome === BIOME.DESERT;
        if (desert ? ground !== B.SAND : ground !== B.GRASS && ground !== B.SNOWY_GRASS) continue;
        if (isCave(tx, info.h, tz, info.h)) continue;
        const v = hash2(gx, gz, treeSeed + 3);
        const h = info.h;
        if (desert) {
          const tall = 1 + Math.floor(v * 3);
          for (let y = 1; y <= tall; y++) set(tx, h + y, tz, B.CACTUS, false);
        } else if (info.biome === BIOME.TUNDRA || info.biome === BIOME.MOUNTAINS) {
          spruceTree(set, tx, h, tz, 6 + Math.floor(v * 4));
        } else if (info.biome === BIOME.FOREST && v < 0.3) {
          broadleafTree(set, tx, h, tz, 5 + Math.floor(v * 10) % 3, B.BIRCH_LOG, B.BIRCH_LEAVES, treeSeed + 4);
        } else {
          broadleafTree(set, tx, h, tz, 4 + Math.floor(v * 7) % 3, B.OAK_LOG, B.OAK_LEAVES, treeSeed + 4);
        }
      }
    }
  }

  function columnInfo(x, z) {
    return column(Math.floor(x), Math.floor(z), {});
  }

  // A dry spot near the origin, preferably grassland.
  function findSpawn() {
    const info = {};
    let fallback = null;
    for (let ring = 0; ring < 120; ring++) {
      for (let i = 0; i < Math.max(1, ring * 8); i++) {
        const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * ring * 8);
        const z = Math.round(Math.sin(a) * ring * 8);
        column(x, z, info);
        if (info.h <= SEA_LEVEL + 1 || isCave(x, info.h, z, info.h)) continue;
        const spot = { x: x + 0.5, y: info.h + 1, z: z + 0.5 };
        if (info.biome === BIOME.PLAINS || info.biome === BIOME.FOREST) return spot;
        fallback ??= spot;
      }
    }
    return fallback ?? { x: 0.5, y: HEIGHT - 20, z: 0.5 };
  }

  return {
    seed,
    dimension: 'overworld',
    generateChunk,
    columnInfo,
    findSpawn,
    strongholds,
    chestLoot,
    spawnerMob,
    locate,
    biomeName: (x, z) => BIOME_NAMES[columnInfo(x, z).biome],
    residentsIn,
  };
}
