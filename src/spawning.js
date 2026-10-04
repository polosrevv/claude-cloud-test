// Natural mob spawning, monster spawners, and the one-time population of new
// chunks (animal herds, chest loot, spawner settings).
import { B, SOLID, FLUID, OPAQUE } from './blocks.js';
import { CHUNK, HEIGHT, blockIndex } from './constants.js';
import { createMob, createSlime } from './mobs.js';
import { generateLoot } from './inventory.js';
import { hash2, hash3 } from './noise.js';
import { boxIsFree } from './physics.js';
import { BIOME } from './terrain.js';
import { posKey } from './world.js';

const CAPS = { overworld: 28, nether: 22, end: 16 };

function pick(weights) {
  let total = 0;
  for (const [, w] of weights) total += w;
  let r = Math.random() * total;
  for (const [type, w] of weights) {
    r -= w;
    if (r <= 0) return type;
  }
  return weights[0][0];
}

function clearAt(world, x, y, z, height) {
  for (let k = 0; k < height; k++) {
    const id = world.getBlock(x, y + k, z, B.BEDROCK);
    if (SOLID[id] || FLUID[id]) return false;
  }
  return true;
}

// A spot to stand on near column (x, z), searching down from y.
function floorBelow(world, x, y, z, height, depth = 12) {
  for (let k = 0; k < depth && y - k > 1; k++) {
    const yy = y - k;
    const below = world.getBlock(x, yy - 1, z);
    if (OPAQUE[below] && SOLID[below] && below !== B.BEDROCK && clearAt(world, x, yy, z, height)) return yy;
  }
  return null;
}

// One chunk in ten is a slime chunk: slimes spawn there below y = 40 in any light.
export function slimeChunk(seed, x, z) {
  return hash2(Math.floor(x / CHUNK), Math.floor(z / CHUNK), seed ^ 0x3ad8025f) < 0.1;
}

// Squid keep the oceans and lakes company (they have their own small cap).
function spawnWaterCreature(game) {
  const world = game.world;
  const p = game.player;
  if (game.entities.count((e) => e.type === 'squid') >= 5) return;
  const a = Math.random() * Math.PI * 2;
  const d = 20 + Math.random() * 30;
  const x = Math.floor(p.pos[0] + Math.cos(a) * d);
  const z = Math.floor(p.pos[2] + Math.sin(a) * d);
  if (!world.isLoaded(x, z)) return;
  const top = world.surfaceY(x, z);
  for (let y = top + 1; y < top + 12; y++) {
    if (FLUID[world.getBlock(x, y, z)] !== 1) continue;
    if (FLUID[world.getBlock(x, y + 1, z)] !== 1 || FLUID[world.getBlock(x, y + 2, z)] !== 1) return;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) game.entities.add(createMob('squid', x + 0.5 + Math.random(), y + 0.5, z + 0.5 + Math.random()));
    return;
  }
}

// Ghasts roam the Nether's big open caverns; they have their own small cap.
function spawnGhast(game) {
  const world = game.world;
  const p = game.player;
  if (game.entities.count((e) => e.type === 'ghast') >= 3) return;
  const a = Math.random() * Math.PI * 2;
  const d = 30 + Math.random() * 30;
  const x = Math.floor(p.pos[0] + Math.cos(a) * d);
  const z = Math.floor(p.pos[2] + Math.sin(a) * d);
  const y = 30 + Math.floor(Math.random() * 70);
  if (!world.isLoaded(x - 3, z - 3) || !world.isLoaded(x + 3, z + 3)) return;
  // A big pocket of open air (lava below is fine).
  if (!boxIsFree(world, x - 2.5, y, z - 2.5, x + 2.5, y + 5, z + 2.5)) return;
  for (let k = 0; k < 4; k++) if (FLUID[world.getBlock(x, y + k, z)]) return;
  game.entities.add(createMob('ghast', x + 0.5, y, z + 0.5));
}

export function spawnTick(game) {
  const world = game.world;
  const p = game.player;
  if (game.difficulty === 'peaceful' || !game.gamerules.doMobSpawning) return;
  const dim = world.dimension;
  if (dim === 'overworld' && Math.random() < 0.25) spawnWaterCreature(game);
  if (dim === 'nether' && Math.random() < 0.2) spawnGhast(game);
  const hostile = game.entities.count((e) => e.kind === 'mob' && e.def.hostile && e.type !== 'dragon');
  if (hostile >= CAPS[dim]) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * 28;
    const x = Math.floor(p.pos[0] + Math.cos(a) * d);
    const z = Math.floor(p.pos[2] + Math.sin(a) * d);
    if (!world.isLoaded(x, z) || !world.isLoaded(x + 1, z + 1)) continue;
    let type;
    let y;
    if (dim === 'overworld') {
      const top = world.surfaceY(x, z);
      const startY = Math.random() < 0.5 ? top + 1 : 2 + Math.floor(Math.random() * Math.max(1, top));
      type = pick([['zombie', 30], ['skeleton', 25], ['creeper', 25], ['spider', 20], ['enderman', 3]]);
      y = floorBelow(world, x, startY, z, type === 'enderman' ? 3 : 2, 24);
      if (y !== null && y < 40 && slimeChunk(world.seed, x, z) && Math.random() < 0.35) {
        const size = [1, 2, 4][Math.floor(Math.random() * 3)];
        if (boxIsFree(world, x + 0.5 - 0.26 * size, y, z + 0.5 - 0.26 * size, x + 0.5 + 0.26 * size, y + 0.52 * size, z + 0.5 + 0.26 * size)) {
          game.entities.add(createSlime(size, x + 0.5, y, z + 0.5));
        }
        continue;
      }
      if (y === null || game.lightAt(x, y, z) > 7) continue;
    } else if (dim === 'nether') {
      const startY = 20 + Math.floor(Math.random() * 90);
      const inFortress = world.terrain.insideFortress(x, startY, z);
      type = inFortress ? pick([['blaze', 3], ['wither_skeleton', 3], ['magma_cube', 1], ['zombie_pigman', 1]]) : pick([['zombie_pigman', 12], ['magma_cube', 2], ['enderman', 1]]);
      if (type === 'magma_cube') {
        y = floorBelow(world, x, startY, z, 3, 30);
        if (y !== null) game.entities.add(createSlime([1, 2, 4][Math.floor(Math.random() * 3)], x + 0.5, y, z + 0.5, 'magma_cube'));
        continue;
      }
      y = floorBelow(world, x, startY, z, 2, 30);
      if (y === null) continue;
      if (type === 'blaze' && world.getBlock(x, y - 1, z) !== B.NETHER_BRICKS) continue;
      if (type === 'wither_skeleton' && !clearAt(world, x, y, z, 3)) continue;
      if (type !== 'blaze' && type !== 'zombie_pigman' && type !== 'wither_skeleton' && Math.random() < 0.6) continue;
    } else {
      type = 'enderman';
      y = floorBelow(world, x, 80, z, 3, 50);
      if (y === null || world.getBlock(x, y - 1, z) !== B.END_STONE) continue;
    }
    if (Math.hypot(x + 0.5 - p.pos[0], y - p.pos[1], z + 0.5 - p.pos[2]) < 20) continue;
    const pack = type === 'enderman' || type === 'blaze' || type === 'wither_skeleton' ? 1 : type === 'zombie_pigman' ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pack; i++) {
      const sx = x + (i ? Math.floor(Math.random() * 5) - 2 : 0);
      const sz = z + (i ? Math.floor(Math.random() * 5) - 2 : 0);
      const sy = i ? floorBelow(world, sx, y + 2, sz, 2, 5) : y;
      if (sy === null) continue;
      if (dim === 'overworld' && game.lightAt(sx, sy, sz) > 7) continue;
      game.entities.add(createMob(type, sx + 0.5, sy, sz + 0.5));
    }
  }
}

export function spawnerTick(game) {
  const world = game.world;
  const p = game.player.pos;
  for (const [key, be] of world.blockEntities) {
    if (be.type !== 'spawner') continue;
    const [x, y, z] = key.split(',').map(Number);
    if (Math.abs(x - p[0]) > 16 || Math.abs(y - p[1]) > 16 || Math.abs(z - p[2]) > 16) continue;
    if (!world.isLoaded(x, z) || world.getBlock(x, y, z) !== B.SPAWNER) continue;
    if (game.tickCount % 10 === 0) game.particles.burst([x + 0.5, y + 0.5, z + 0.5], 'flame', 1, 0.4);
    if (game.difficulty === 'peaceful') continue;
    be.delay = (be.delay ?? 200) - 1;
    if (be.delay > 0) continue;
    be.delay = 200 + Math.floor(Math.random() * 600);
    const nearby = game.entities.count((e) => e.kind === 'mob' && e.type === be.mob && Math.abs(e.pos[0] - x) < 9 && Math.abs(e.pos[2] - z) < 9);
    if (nearby >= 6) continue;
    for (let i = 0; i < 4; i++) {
      const sx = x + Math.floor(Math.random() * 9) - 4;
      const sz = z + Math.floor(Math.random() * 9) - 4;
      const sy = floorBelow(world, sx, y + 1, sz, 2, 3);
      if (sy === null) continue;
      if (be.mob !== 'blaze' && game.lightAt(sx, sy, sz) > 11) continue;
      game.entities.add(createMob(be.mob, sx + 0.5, sy, sz + 0.5));
      game.particles.burst([sx + 0.5, sy + 0.5, sz + 0.5], 'smoke', 6, 0.5);
    }
  }
}

// First time a chunk loads: spawner and chest data, and the odd herd of animals.
export function populateChunk(game, world, chunk) {
  if (world.populated.has(chunk.key)) return;
  world.populated.add(chunk.key);
  const blocks = chunk.blocks;
  const x0 = chunk.cx * CHUNK;
  const z0 = chunk.cz * CHUNK;
  for (let i = 0; i < blocks.length; i++) {
    const id = blocks[i];
    if (id !== B.SPAWNER && id !== B.CHEST_N && id !== B.CHEST_E && id !== B.CHEST_S && id !== B.CHEST_W) continue;
    const lx = i % CHUNK;
    const lz = Math.floor(i / CHUNK) % CHUNK;
    const y = Math.floor(i / (CHUNK * CHUNK));
    const x = x0 + lx;
    const z = z0 + lz;
    const key = posKey(x, y, z);
    if (world.blockEntities.has(key)) continue;
    if (id === B.SPAWNER) {
      world.blockEntities.set(key, { type: 'spawner', mob: world.terrain.spawnerMob(x, y, z), delay: 20 });
    } else {
      const table = world.terrain.chestLoot(x, y, z);
      world.blockEntities.set(key, { type: 'chest', slots: generateLoot(table, Math.floor(hash3(x, y, z, world.seed) * 4294967296)) });
    }
  }
  if (world.dimension === 'overworld') {
    for (const r of world.terrain.residentsIn?.(chunk.cx, chunk.cz) ?? []) {
      const m = createMob(r.type, r.x, r.y, r.z);
      m.home = r.village;
      m.persistent = true;
      if (r.profession) m.profession = r.profession;
      game.entities.add(m);
    }
  }
  if (world.dimension !== 'overworld' || Math.random() > 0.12) return;
  const biome = world.terrain.columnInfo?.(x0 + 8, z0 + 8).biome;
  const wolves = biome === BIOME.FOREST || biome === BIOME.TUNDRA ? 2 : 0;
  const type = pick([['pig', 3], ['cow', 3], ['sheep', 4], ['chicken', 3], ['wolf', wolves]]);
  const n = 2 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const lx = Math.floor(Math.random() * CHUNK);
    const lz = Math.floor(Math.random() * CHUNK);
    for (let y = HEIGHT - 2; y > 1; y--) {
      const id = blocks[blockIndex(lx, y, lz)];
      if (id === B.AIR) continue;
      if (id === B.GRASS && blocks[blockIndex(lx, y + 1, lz)] === B.AIR && blocks[blockIndex(lx, y + 2, lz)] === B.AIR) {
        game.entities.add(createMob(type, x0 + lx + 0.5, y + 1, z0 + lz + 0.5));
      }
      break;
    }
  }
}
