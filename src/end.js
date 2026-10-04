// The End: one end stone island floating in the void, ringed by obsidian
// pillars. The exit portal waits at the centre for the dragon to fall.
import { Simplex, mulberry32 } from './noise.js';
import { B, facingBlock } from './blocks.js';
import { CHUNK, HEIGHT, blockIndex } from './constants.js';

export const END_SPAWN = { x: 100.5, y: 49, z: 0.5 };
const ISLAND = 88;

export function createEnd(seed) {
  const rnd = mulberry32(seed ^ 0xe4d);
  const edge = new Simplex(rnd);
  const surface = new Simplex(rnd);
  const turn = rnd() * Math.PI * 2;

  function islandColumn(x, z) {
    const d = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const r = ISLAND + edge.noise2(Math.cos(a) * 2, Math.sin(a) * 2) * 10;
    if (d >= r) return null;
    const t = 1 - d / r;
    const top = 60 + Math.floor(t * 6 + surface.noise2(x / 20, z / 20) * 2);
    const bottom = 60 - Math.floor(Math.sqrt(t) * 34 + 2);
    return { top, bottom };
  }

  // Ten pillars of increasing height; each carries an end crystal.
  const pillars = [];
  for (let i = 0; i < 10; i++) {
    const a = turn + (i * Math.PI * 2) / 10;
    const x = Math.round(Math.cos(a) * 42);
    const z = Math.round(Math.sin(a) * 42);
    const radius = 2 + (i % 3);
    const height = 76 + ((i * 7) % 10) * 3;
    pillars.push({ x, z, radius, height, crystal: [x + 0.5, height + 2, z + 0.5] });
  }
  const portalY = (islandColumn(0, 0)?.top ?? 64) + 1;

  function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const set = (x, y, z, id) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      data[blockIndex(lx, y, lz)] = id;
    };
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const col = islandColumn(x0 + x, z0 + z);
        if (!col) continue;
        for (let y = col.bottom; y <= col.top; y++) data[blockIndex(x, y, z)] = B.END_STONE;
      }
    }
    for (const p of pillars) {
      if (p.x + p.radius < x0 || p.x - p.radius >= x0 + CHUNK || p.z + p.radius < z0 || p.z - p.radius >= z0 + CHUNK) continue;
      for (let dz = -p.radius; dz <= p.radius; dz++) {
        for (let dx = -p.radius; dx <= p.radius; dx++) {
          if (dx * dx + dz * dz > p.radius * p.radius + p.radius) continue;
          for (let y = 50; y <= p.height; y++) set(p.x + dx, y, p.z + dz, B.OBSIDIAN);
        }
      }
      set(p.x, p.height + 1, p.z, B.BEDROCK);
    }
    exitPortal(set, false);
    // Obsidian landing platform for arrivals.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        set(100 + dx, 48, dz, B.OBSIDIAN);
        for (let y = 49; y <= 51; y++) set(100 + dx, y, dz, B.AIR);
      }
    }
    return data;
  }

  // The bedrock fountain at the centre; `active` fills it with portal blocks.
  function exitPortal(set, active) {
    const y = portalY;
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > 12.5) continue;
        set(dx, y - 1, dz, B.BEDROCK);
        if (d2 > 6.5) set(dx, y, dz, B.BEDROCK);
        else set(dx, y, dz, active && d2 > 0 ? B.END_PORTAL : B.AIR);
        for (let k = 1; k <= 4; k++) if (!(dx === 0 && dz === 0)) set(dx, y + k, dz, B.AIR);
      }
    }
    for (let k = 0; k <= 3; k++) set(0, y + k, 0, B.BEDROCK);
    set(1, y + 2, 0, facingBlock('wall_torch', 1));
    set(-1, y + 2, 0, facingBlock('wall_torch', 3));
    set(0, y + 2, 1, facingBlock('wall_torch', 2));
    set(0, y + 2, -1, facingBlock('wall_torch', 0));
  }

  return {
    seed,
    dimension: 'end',
    generateChunk,
    pillars,
    portalY,
    exitPortal,
    findSpawn: () => ({ ...END_SPAWN }),
    locate: () => null,
    chestLoot: () => 'dungeon',
    spawnerMob: () => 'enderman',
    columnInfo: () => ({ h: 60, biome: 0 }),
    biomeName: () => 'The End',
  };
}
