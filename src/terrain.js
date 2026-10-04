// Deterministic world generation. Every feature is a pure function of the
// seed and world coordinates, so a chunk can be generated in any order (and on
// any worker) and trees that straddle chunk borders still line up.
import { Simplex, mulberry32, hash2, hash3 } from './noise.js';
import { B, PLANT, LEAVES } from './blocks.js';

export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 48;

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TUNDRA: 5, MOUNTAINS: 6, PEAKS: 7 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy Tundra', 'Mountains', 'Snowy Peaks'];

// Chance that a 5x5 tree cell actually grows a tree, per biome.
const TREE_DENSITY = [0, 0, 0.05, 0.72, 0.14, 0.3, 0.12, 0];
const TREE_CELL = 5;

export const blockIndex = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createTerrain(seed) {
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
          if (data[i] !== B.BEDROCK && isCave(wx, y, wz, h)) data[i] = B.AIR;
        }
      }
    }

    addOres(data, cx, cz);
    addPlants(data, heights, biomes, x0, z0);
    addTrees(data, x0, z0, info);
    return data;
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
          else if (biome === BIOME.FOREST) id = p < 0.08 ? B.TALL_GRASS : p < 0.09 ? B.POPPY : p < 0.1 ? B.DANDELION : B.AIR;
          else if (p < 0.06) id = B.TALL_GRASS;
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
          spruce(set, tx, h, tz, 6 + Math.floor(v * 4));
        } else if (info.biome === BIOME.FOREST && v < 0.3) {
          broadleaf(set, tx, h, tz, 5 + Math.floor(v * 10) % 3, B.BIRCH_LOG, B.BIRCH_LEAVES);
        } else {
          broadleaf(set, tx, h, tz, 4 + Math.floor(v * 7) % 3, B.OAK_LOG, B.OAK_LEAVES);
        }
      }
    }
  }

  function broadleaf(set, x, ground, z, trunk, log, leaf) {
    const top = ground + trunk;
    for (let y = ground + 1; y <= top; y++) set(x, y, z, log, true);
    for (let y = top - 2; y <= top + 1; y++) {
      const r = y >= top ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y === top + 1 || hash3(x + dx, y, z + dz, treeSeed + 4) < 0.5)) continue;
          set(x + dx, y, z + dz, leaf, false);
        }
      }
    }
  }

  function spruce(set, x, ground, z, trunk) {
    const top = ground + trunk;
    for (let y = ground + 1; y <= top; y++) set(x, y, z, B.SPRUCE_LOG, true);
    const radii = [0, 1, 1, 2, 1, 2, 3, 2, 3];
    for (let i = 0; i < radii.length; i++) {
      const y = top + 1 - i;
      if (y <= ground + 2) break;
      const r = radii[i];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz <= r * r + 0.5) set(x + dx, y, z + dz, B.SPRUCE_LEAVES, false);
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

  return { seed, generateChunk, columnInfo, findSpawn };
}
