// The Nether: a cavernous netherrack world over a lava sea, with glowstone
// hanging from the ceiling and fortresses where blazes live.
import { Simplex, mulberry32, hash2, hash3 } from './noise.js';
import { B } from './blocks.js';
import { CHUNK, HEIGHT, blockIndex } from './constants.js';
import { fortress, FORTRESS_Y, FORTRESS_REACH } from './structures.js';

export const NETHER_LAVA = 31;
const FORTRESS_REGION = 352;

export function createNether(seed) {
  const rnd = mulberry32(seed ^ 0x4e7e);
  const big = new Simplex(rnd);
  const detail = new Simplex(rnd);
  const patches = new Simplex(rnd);
  const fortressSeed = seed ^ 0xf047;

  // Positive density is rock. Solid near the floor and ceiling, open in between.
  function density(x, y, z) {
    let d = big.noise3(x / 52, y / 30, z / 52) * 0.95 + detail.noise3(x / 18, y / 14, z / 18) * 0.35;
    if (y < 26) d += ((26 - y) / 26) * 1.4;
    if (y > 96) d += ((y - 96) / 28) * 1.8;
    return d - 0.05;
  }

  function fortressIn(gx, gz) {
    if (hash2(gx, gz, fortressSeed) > 0.75) return null;
    const x = gx * FORTRESS_REGION + 80 + Math.floor(hash2(gx, gz, fortressSeed + 1) * (FORTRESS_REGION - 160));
    const z = gz * FORTRESS_REGION + 80 + Math.floor(hash2(gx, gz, fortressSeed + 2) * (FORTRESS_REGION - 160));
    return { x, z };
  }

  function fortressesNear(x0, z0, x1, z1) {
    const out = [];
    const reach = FORTRESS_REACH + 8;
    for (let gz = Math.floor((z0 - reach) / FORTRESS_REGION); gz <= Math.floor((z1 + reach) / FORTRESS_REGION); gz++) {
      for (let gx = Math.floor((x0 - reach) / FORTRESS_REGION); gx <= Math.floor((x1 + reach) / FORTRESS_REGION); gx++) {
        const f = fortressIn(gx, gz);
        if (f && f.x + reach >= x0 && f.x - reach <= x1 && f.z + reach >= z0 && f.z - reach <= z1) out.push(f);
      }
    }
    return out;
  }

  function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    // Sample density on a coarse grid and interpolate: smoother caverns, far fewer noise calls.
    const SX = 4;
    const SY = 8;
    const nx = CHUNK / SX + 1;
    const ny = HEIGHT / SY + 1;
    const grid = new Float32Array(nx * nx * ny);
    for (let gy = 0; gy < ny; gy++) {
      for (let gz = 0; gz < nx; gz++) {
        for (let gx = 0; gx < nx; gx++) grid[(gy * nx + gz) * nx + gx] = density(x0 + gx * SX, gy * SY, z0 + gz * SX);
      }
    }
    for (let y = 0; y < HEIGHT; y++) {
      const gy = Math.min(ny - 2, Math.floor(y / SY));
      const ty = (y - gy * SY) / SY;
      for (let z = 0; z < CHUNK; z++) {
        const gz = Math.floor(z / SX);
        const tz = (z - gz * SX) / SX;
        for (let x = 0; x < CHUNK; x++) {
          const gx = Math.floor(x / SX);
          const tx = (x - gx * SX) / SX;
          const at = (ax, ay, az) => grid[((gy + ay) * nx + gz + az) * nx + gx + ax];
          const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tx;
          const c10 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tx;
          const c01 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tx;
          const c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tx;
          const d = (c00 + (c10 - c00) * tz) + ((c01 + (c11 - c01) * tz) - (c00 + (c10 - c00) * tz)) * ty;
          const wx = x0 + x;
          const wz = z0 + z;
          let id;
          if (y === 0 || y === HEIGHT - 1) id = B.BEDROCK;
          else if (y < 5 && hash3(wx, y, wz, seed) < (5 - y) * 0.2) id = B.BEDROCK;
          else if (y > HEIGHT - 6 && hash3(wx, y, wz, seed) < (y - (HEIGHT - 6)) * 0.2) id = B.BEDROCK;
          else if (d > 0) id = B.NETHERRACK;
          else id = y <= NETHER_LAVA ? B.LAVA : B.AIR;
          data[blockIndex(x, y, z)] = id;
        }
      }
    }
    decorate(data, x0, z0, cx, cz);
    for (const f of fortressesNear(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
      const set = (x, y, z, id) => {
        const lx = x - x0;
        const lz = z - z0;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT - 1) return;
        data[blockIndex(lx, y, lz)] = id;
      };
      // Pillars stop at the first rock (or the lava sea) below the bridge.
      const columnBottom = (x, z, from) => {
        const lx = x - x0;
        const lz = z - z0;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK) return from;
        for (let y = from; y > 4; y--) {
          const id = data[blockIndex(lx, y, lz)];
          if (id !== B.AIR) return y;
        }
        return 4;
      };
      fortress(set, columnBottom, f.x, f.z);
    }
    return data;
  }

  function decorate(data, x0, z0, cx, cz) {
    const r = mulberry32(Math.floor(hash2(cx, cz, seed ^ 0x9e7) * 4294967296));
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const soul = patches.noise2(wx / 24, wz / 24);
        const gravel = patches.noise2(wx / 18 + 50, wz / 18 + 50);
        for (let y = HEIGHT - 2; y > 1; y--) {
          const i = blockIndex(x, y, z);
          const id = data[i];
          // Floors: soul sand and gravel patches near the lava shore, rare fires.
          if (id === B.NETHERRACK && data[i + CHUNK * CHUNK] === B.AIR) {
            if (y < 44 && soul > 0.45) {
              for (let k = 0; k < 3 && data[i - k * CHUNK * CHUNK] === B.NETHERRACK; k++) data[i - k * CHUNK * CHUNK] = B.SOUL_SAND;
            } else if (y >= NETHER_LAVA - 1 && y < 38 && gravel > 0.55) {
              data[i] = B.GRAVEL;
            } else if (hash3(wx, y, wz, seed ^ 0xf1) < 0.004) {
              data[i + CHUNK * CHUNK] = B.FIRE;
            }
          }
          // Ceilings: glowstone clusters.
          if (id === B.NETHERRACK && data[i - CHUNK * CHUNK] === B.AIR && y > 50 && hash3(wx, y, wz, seed ^ 0x610) < 0.012) {
            let gx = x;
            let gz = z;
            let gy = y - 1;
            for (let k = 0; k < 14; k++) {
              if (gx >= 0 && gx < CHUNK && gz >= 0 && gz < CHUNK && gy > 1 && data[blockIndex(gx, gy, gz)] === B.AIR) {
                data[blockIndex(gx, gy, gz)] = B.GLOWSTONE;
              }
              const step = r();
              if (step < 0.4) gy--;
              else if (step < 0.55) gx++;
              else if (step < 0.7) gx--;
              else if (step < 0.85) gz++;
              else gz--;
            }
          }
        }
      }
    }
    // Quartz veins.
    for (let v = 0; v < 14; v++) {
      let x = (r() * CHUNK) | 0;
      let y = 10 + ((r() * 108) | 0);
      let z = (r() * CHUNK) | 0;
      for (let s = 0; s < 7; s++) {
        if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
          const i = blockIndex(x, y, z);
          if (data[i] === B.NETHERRACK) data[i] = B.NETHER_QUARTZ_ORE;
        }
        const axis = (r() * 3) | 0;
        const step = r() < 0.5 ? -1 : 1;
        if (axis === 0) x += step; else if (axis === 1) y += step; else z += step;
      }
    }
  }

  function locate(kind, x, z) {
    if (kind !== 'fortress') return null;
    let best = null;
    const g0 = Math.floor(x / FORTRESS_REGION);
    const h0 = Math.floor(z / FORTRESS_REGION);
    for (let gz = h0 - 3; gz <= h0 + 3; gz++) {
      for (let gx = g0 - 3; gx <= g0 + 3; gx++) {
        const f = fortressIn(gx, gz);
        if (!f) continue;
        const d = Math.hypot(f.x - x, f.z - z);
        if (!best || d < best.distance) best = { x: f.x, y: FORTRESS_Y + 1, z: f.z, distance: d };
      }
    }
    return best;
  }

  function insideFortress(x, y, z) {
    if (Math.abs(y - FORTRESS_Y) > 10) return false;
    return fortressesNear(x, z, x, z).some((f) => Math.abs(f.x - x) <= FORTRESS_REACH + 4 && Math.abs(f.z - z) <= FORTRESS_REACH + 4);
  }

  // A standing spot near (x, z) for arriving through a portal.
  function findSpawn() {
    return { x: 0.5, y: 70, z: 0.5 };
  }

  return {
    seed,
    dimension: 'nether',
    generateChunk,
    findSpawn,
    locate,
    insideFortress,
    chestLoot: () => 'fortress',
    spawnerMob: () => 'blaze',
    columnInfo: () => ({ h: 64, biome: 0 }),
    biomeName: () => 'Nether Wastes',
  };
}
