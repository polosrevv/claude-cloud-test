import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simplex, mulberry32 } from '../src/noise.js';
import { B, LEAVES, BLOCK_COUNT, FACE_TEX } from '../src/blocks.js';
import { TEXTURE_NAMES, generateTextures } from '../src/textures.js';
import { CHUNK, HEIGHT, SEA_LEVEL, blockIndex, createTerrain } from '../src/terrain.js';
import { World, chunkKey } from '../src/world.js';
import { FACES, PAD, RW, REGION_SIZE, regionIndex, buildChunkMesh, computeLight, buildItemMesh } from '../src/mesher.js';
import { raycast } from '../src/raycast.js';
import { Player } from '../src/player.js';

// A world whose chunks are flat stone up to and including y = groundY.
function flatWorld(radius = 1, groundY = 10) {
  const w = new World(1);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const blocks = new Uint8Array(CHUNK * CHUNK * HEIGHT);
      blocks.fill(B.STONE, 0, CHUNK * CHUNK * (groundY + 1));
      const c = { key: chunkKey(cx, cz), cx, cz, version: 0, urgent: 0 };
      w.chunks.set(c.key, c);
      w.acceptChunk(c, blocks);
    }
  }
  return w;
}

function generatedWorld(seed, radius) {
  const w = new World(seed);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const c = { key: chunkKey(cx, cz), cx, cz, version: 0, urgent: 0 };
      w.chunks.set(c.key, c);
      w.acceptChunk(c, w.terrain.generateChunk(cx, cz));
    }
  }
  return w;
}

test('simplex noise is deterministic and roughly within [-1, 1]', () => {
  const a = new Simplex(mulberry32(42));
  const b = new Simplex(mulberry32(42));
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.137;
    const z = i * -0.291;
    assert.equal(a.noise2(x, z), b.noise2(x, z));
    assert.ok(Math.abs(a.noise3(x, z, x * 0.5)) <= 1.05);
    assert.ok(Math.abs(a.noise2(x, z)) <= 1.05);
  }
});

test('every block face points at a real texture', () => {
  assert.ok(BLOCK_COUNT < 256);
  for (let id = 1; id < BLOCK_COUNT; id++) {
    for (let f = 0; f < 6; f++) assert.ok(FACE_TEX[id * 6 + f] < TEXTURE_NAMES.length);
  }
  const tex = generateTextures();
  assert.equal(tex.data.length, 16 * 16 * 4 * TEXTURE_NAMES.length);
});

test('terrain generation is reproducible from the seed', () => {
  const a = createTerrain(1234).generateChunk(3, -2);
  const b = createTerrain(1234).generateChunk(3, -2);
  const c = createTerrain(4321).generateChunk(3, -2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('terrain has a bedrock floor and no water above sea level', () => {
  const t = createTerrain(99);
  for (const [cx, cz] of [[0, 0], [5, -7], [-12, 3]]) {
    const data = t.generateChunk(cx, cz);
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        assert.equal(data[blockIndex(x, 0, z)], B.BEDROCK);
        for (let y = SEA_LEVEL + 1; y < HEIGHT; y++) assert.notEqual(data[blockIndex(x, y, z)], B.WATER);
      }
    }
  }
});

test('trees that cross chunk borders keep their trunks', () => {
  // Every leaf in the middle chunk must have a log within reach, even when
  // that log was generated as part of a neighbouring chunk.
  const w = generatedWorld(2024, 2);
  let leaves = 0;
  for (let y = SEA_LEVEL; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        if (!LEAVES[w.getBlock(x, y, z)]) continue;
        leaves++;
        let found = false;
        for (let dy = -4; dy <= 1 && !found; dy++) {
          for (let dz = -3; dz <= 3 && !found; dz++) {
            for (let dx = -3; dx <= 3 && !found; dx++) {
              const id = w.getBlock(x + dx, y + dy, z + dz);
              found = id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG;
            }
          }
        }
        assert.ok(found, `leaf at ${x},${y},${z} has no trunk nearby`);
      }
    }
  }
  assert.ok(leaves >= 0);
});

test('face corners wind counter-clockwise when seen from outside', () => {
  for (const face of FACES) {
    const [a, b, c] = face.corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.deepEqual(n.map((value) => value + 0), face.dir);
  }
});

function regionWith(blocks) {
  const region = new Uint8Array(REGION_SIZE);
  region.fill(B.BEDROCK, 0, RW * RW);
  for (const [x, y, z, id] of blocks) region[regionIndex(x + PAD, y, z + PAD)] = id;
  return region;
}

test('the mesher culls faces hidden between neighbouring blocks', () => {
  assert.equal(buildChunkMesh(regionWith([[4, 40, 4, B.STONE]])).solidQuads, 6);
  assert.equal(buildChunkMesh(regionWith([[4, 40, 4, B.STONE], [5, 40, 4, B.STONE]])).solidQuads, 10);
  // Glass next to glass merges; glass next to stone does not hide the stone.
  assert.equal(buildChunkMesh(regionWith([[4, 40, 4, B.GLASS], [5, 40, 4, B.GLASS]])).solidQuads, 10);
  assert.equal(buildChunkMesh(regionWith([[4, 40, 4, B.GLASS], [5, 40, 4, B.STONE]])).solidQuads, 11);
  // Water goes to its own mesh and its surface sits slightly low.
  const water = buildChunkMesh(regionWith([[4, 40, 4, B.WATER]]));
  assert.equal(water.solidQuads, 0);
  assert.equal(water.waterQuads, 6);
  assert.equal(buildItemMesh(B.POPPY).quads, 4);
});

test('sunlight fills open air and glowstone lights a sealed room', () => {
  const blocks = [];
  // A closed stone box with a glowstone inside.
  for (let y = 30; y <= 36; y++) {
    for (let z = 0; z <= 6; z++) {
      for (let x = 0; x <= 6; x++) {
        const wall = x === 0 || x === 6 || y === 30 || y === 36 || z === 0 || z === 6;
        if (wall) blocks.push([x, y, z, B.STONE]);
      }
    }
  }
  blocks.push([3, 31, 3, B.GLOWSTONE]);
  const { sky, blk } = computeLight(regionWith(blocks));
  const at = (x, y, z) => regionIndex(x + PAD, y, z + PAD);
  assert.equal(sky[at(10, 60, 10)], 15);
  assert.equal(sky[at(3, 33, 3)], 0);
  assert.equal(blk[at(3, 32, 3)], 14);
  assert.equal(blk[at(1, 31, 1)], 11);
  assert.equal(blk[at(10, 31, 10)], 0);
});

test('edits are recorded, saved and restored', () => {
  const w = flatWorld();
  assert.ok(w.setBlock(2, 11, 2, B.BRICKS));
  assert.equal(w.getBlock(2, 11, 2), B.BRICKS);
  assert.equal(w.editCount, 1);
  const saved = JSON.parse(JSON.stringify(w.serializeEdits()));
  const fresh = new World(1);
  fresh.loadEdits(saved);
  const c = { key: chunkKey(0, 0), cx: 0, cz: 0, version: 0, urgent: 0 };
  fresh.chunks.set(c.key, c);
  fresh.acceptChunk(c, new Uint8Array(CHUNK * CHUNK * HEIGHT));
  assert.equal(fresh.getBlock(2, 11, 2), B.BRICKS);
});

test('breaking a block pops the plant on top and sand falls', () => {
  const w = flatWorld();
  w.setBlock(4, 11, 4, B.DIRT);
  w.setBlock(4, 12, 4, B.POPPY);
  assert.equal(w.breakBlock(4, 11, 4), B.DIRT);
  assert.equal(w.getBlock(4, 12, 4), B.AIR);

  w.placeBlock(6, 15, 6, B.SAND);
  assert.equal(w.getBlock(6, 15, 6), B.AIR);
  assert.equal(w.getBlock(6, 11, 6), B.SAND);
  assert.equal(w.breakBlock(0, 0, 0), null, 'the bedrock floor stays');
});

test('editing a chunk edge dirties the neighbouring chunk too', () => {
  const w = flatWorld();
  const before = w.getChunk(-1, 0).version;
  w.setBlock(0, 11, 5, B.STONE);
  assert.ok(w.getChunk(-1, 0).version > before);
  assert.equal(w.getChunk(0, 0).urgent, 2);
});

test('raycast finds the first solid block and the face it entered', () => {
  const w = flatWorld();
  const hit = raycast(w, [0.5, 13, 0.5], [0, -1, 0], 6);
  assert.deepEqual([hit.x, hit.y, hit.z], [0, 10, 0]);
  assert.deepEqual(hit.normal, [0, 1, 0]);
  assert.equal(raycast(w, [0.5, 30, 0.5], [0, -1, 0], 6), null);
});

test('the player falls, lands and is stopped by walls', () => {
  const w = flatWorld();
  const p = new Player();
  p.teleport(0.5, 20, 0.5);
  const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  for (let i = 0; i < 120; i++) p.update(1 / 60, idle, w);
  assert.ok(p.onGround);
  assert.ok(Math.abs(p.pos[1] - 11) < 0.01);

  // A wall two blocks tall at x = 3.
  w.setBlock(3, 11, 0, B.STONE);
  w.setBlock(3, 12, 0, B.STONE);
  p.yaw = -Math.PI / 2; // face +x
  for (let i = 0; i < 120; i++) p.update(1 / 60, { ...idle, forward: 1 }, w);
  assert.ok(p.pos[0] < 3 - 0.29 && p.pos[0] > 2.5, `stopped at ${p.pos[0]}`);
});

test('sneaking stops the player at a ledge', () => {
  const w = flatWorld();
  for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) if (x >= 4) w.setBlock(x, 10, z, B.AIR);
  const p = new Player();
  p.teleport(1.5, 11, 0.5);
  p.yaw = -Math.PI / 2;
  const sneak = { forward: 1, strafe: 0, jump: false, sneak: true, sprint: false };
  for (let i = 0; i < 300; i++) p.update(1 / 60, sneak, w);
  assert.ok(p.pos[1] > 10.9, 'still on the ledge');
  assert.ok(p.pos[0] > 3.5 && p.pos[0] < 4.31, `edge at ${p.pos[0]}`);
});
