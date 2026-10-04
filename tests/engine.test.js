import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simplex, mulberry32 } from '../src/noise.js';
import { B, BLOCKS, LEAVES, BLOCK_COUNT, FACE_TEX, RENDER_TYPE, RENDER, MODELS } from '../src/blocks.js';
import { TEXTURE_NAMES, generateTextures } from '../src/textures.js';
import { CHUNK, HEIGHT, SEA_LEVEL, blockIndex } from '../src/constants.js';
import { createTerrain } from '../src/terrain.js';
import { World } from '../src/world.js';
import { FACES, PAD, RW, REGION_SIZE, regionIndex, buildChunkMesh, computeLight, buildBlockItemMesh } from '../src/mesher.js';
import { raycast } from '../src/raycast.js';
import { Player } from '../src/player.js';
import { flatWorld, generatedWorld } from './helpers.js';

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
  assert.ok(BLOCK_COUNT <= 256);
  for (let id = 1; id < BLOCK_COUNT; id++) {
    if (BLOCKS[id].render === RENDER.NONE) continue;
    for (let f = 0; f < 6; f++) assert.ok(FACE_TEX[id * 6 + f] < TEXTURE_NAMES.length, `${BLOCKS[id].key} face ${f}`);
  }
  const tex = generateTextures();
  assert.equal(tex.data.length, 16 * 16 * 4 * TEXTURE_NAMES.length);
});

test('solid cube blocks have fully opaque textures', () => {
  // Catches a texture name being reused (and overwritten) by something see-through.
  const tex = generateTextures();
  for (let id = 1; id < BLOCK_COUNT; id++) {
    const b = BLOCKS[id];
    if (RENDER_TYPE[id] !== RENDER.CUBE || b.opaque === false || b.cutout || b.translucent) continue;
    for (let f = 0; f < 6; f++) {
      const layer = FACE_TEX[id * 6 + f];
      const name = TEXTURE_NAMES[layer];
      const t = tex.tiles[name];
      for (let i = 3; i < t.length; i += 4) assert.equal(t[i], 255, `${b.key} face ${f} (${name}) has see-through pixels`);
    }
  }
});

test('block models stay inside their block', () => {
  for (let id = 1; id < BLOCK_COUNT; id++) {
    if (RENDER_TYPE[id] !== RENDER.MODEL || !MODELS[id]) continue;
    for (const box of MODELS[id]) {
      const from = box.from ?? [box[0], box[1], box[2]];
      const to = box.to ?? [box[3], box[4], box[5]];
      for (let a = 0; a < 3; a++) assert.ok(from[a] <= to[a], `${BLOCKS[id].key} box is inside out`);
    }
  }
});

test('terrain generation is reproducible from the seed', () => {
  for (const dim of ['overworld', 'nether', 'end']) {
    const a = createTerrain(1234, dim).generateChunk(3, -2);
    const b = createTerrain(1234, dim).generateChunk(3, -2);
    assert.deepEqual(a, b, dim);
  }
  assert.notDeepEqual(createTerrain(1234).generateChunk(3, -2), createTerrain(4321).generateChunk(3, -2));
});

test('the overworld has a bedrock floor and no water above sea level', () => {
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

test('the Nether is closed by bedrock above and below', () => {
  const data = createTerrain(7, 'nether').generateChunk(2, 2);
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      assert.equal(data[blockIndex(x, 0, z)], B.BEDROCK);
      assert.equal(data[blockIndex(x, HEIGHT - 1, z)], B.BEDROCK);
    }
  }
});

test('the End has its island, pillars and a place for the exit portal', () => {
  const t = createTerrain(5, 'end');
  assert.equal(t.pillars.length, 10);
  assert.ok(t.portalY > 40 && t.portalY < HEIGHT - 10);
  const data = t.generateChunk(0, 0);
  let endStone = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === B.END_STONE) endStone++;
  assert.ok(endStone > 1000);
});

test('trees that cross chunk borders keep their trunks', () => {
  // Every leaf in the middle chunk must have a log within reach, even when
  // that log was generated as part of a neighbouring chunk.
  const w = generatedWorld(2024, 2);
  for (let y = SEA_LEVEL; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        if (!LEAVES[w.getBlock(x, y, z)]) continue;
        let found = false;
        for (let dy = -5; dy <= 1 && !found; dy++) {
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
});

test('strongholds have twelve end portal frames', () => {
  const t = createTerrain(31337);
  const s = t.locate('stronghold', 0, 0);
  assert.ok(s && s.distance > 300);
  const w = new World(31337);
  let frames = 0;
  for (let cz = Math.floor((s.z - 16) / CHUNK); cz <= Math.floor((s.z + 16) / CHUNK); cz++) {
    for (let cx = Math.floor((s.x - 16) / CHUNK); cx <= Math.floor((s.x + 16) / CHUNK); cx++) {
      const data = w.ensureChunk(cx, cz).blocks;
      for (let i = 0; i < data.length; i++) if (data[i] === B.END_PORTAL_FRAME || data[i] === B.END_PORTAL_FRAME_EYE) frames++;
    }
  }
  assert.equal(frames, 12);
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
  // Water goes to its own mesh.
  const water = buildChunkMesh(regionWith([[4, 40, 4, B.WATER]]));
  assert.equal(water.solidQuads, 0);
  assert.equal(water.waterQuads, 6);
  // Plants are two crossed quads, seen from both sides.
  assert.equal(buildBlockItemMesh(B.POPPY).quads, 4);
  assert.equal(buildBlockItemMesh(B.STONE).quads, 6);
});

test('the mesh reports which layers have anything in them', () => {
  const mesh = buildChunkMesh(regionWith([[4, 40, 4, B.STONE], [2, 70, 9, B.DIRT]]));
  assert.equal(mesh.minY, 40);
  assert.equal(mesh.maxY, 71);
  assert.equal(new Uint8Array(mesh.light).length, CHUNK * CHUNK * HEIGHT);
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

test('dimensions without a sky get no sunlight', () => {
  const { sky } = computeLight(regionWith([]), 0);
  assert.equal(sky[regionIndex(PAD + 3, 100, PAD + 3)], 0);
});

test('edits are recorded, saved and restored', () => {
  const w = flatWorld();
  assert.ok(w.setBlock(2, 11, 2, B.BRICKS));
  assert.equal(w.getBlock(2, 11, 2), B.BRICKS);
  assert.equal(w.editCount, 1);
  w.blockEntities.set('2,11,3', { type: 'chest', slots: [{ item: 'diamond', count: 2, damage: 0 }] });
  const saved = JSON.parse(JSON.stringify(w.serialize()));
  const fresh = new World(1);
  fresh.load(saved);
  const c = fresh.makeChunk(0, 0);
  fresh.chunks.set(c.key, c);
  fresh.acceptChunk(c, new Uint8Array(CHUNK * CHUNK * HEIGHT));
  assert.equal(fresh.getBlock(2, 11, 2), B.BRICKS);
  assert.equal(fresh.blockEntities.get('2,11,3').slots[0].item, 'diamond');
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

test('raycast respects block shapes and skips fluids unless asked', () => {
  const w = flatWorld();
  // Torches are thin, so a ray beside one misses it.
  w.setBlock(3, 11, 3, B.TORCH);
  assert.equal(raycast(w, [3.05, 13, 3.05], [0, -1, 0], 6).y, 10);
  assert.equal(raycast(w, [3.5, 13, 3.5], [0, -1, 0], 6).y, 11);
  w.setBlock(5, 11, 5, B.WATER);
  assert.equal(raycast(w, [5.5, 13, 5.5], [0, -1, 0], 6).y, 10);
  assert.equal(raycast(w, [5.5, 13, 5.5], [0, -1, 0], 6, { fluids: true }).y, 11);
});

const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

test('the player falls, lands and is stopped by walls', () => {
  const w = flatWorld();
  const p = new Player();
  p.teleport(0.5, 20, 0.5);
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

test('the player has to jump onto a full block', () => {
  const w = flatWorld();
  const p = new Player();
  p.teleport(0.5, 11, 0.5);
  w.setBlock(2, 11, 0, B.STONE);
  p.yaw = -Math.PI / 2;
  for (let i = 0; i < 90; i++) p.update(1 / 60, { ...idle, forward: 1 }, w);
  assert.ok(p.pos[1] < 11.01, 'a full block needs a jump');
  for (let i = 0; i < 90; i++) p.update(1 / 60, { ...idle, forward: 1, jump: true }, w);
  assert.ok(p.pos[0] > 2.3 && p.pos[1] >= 12 - 0.01, `jumped up to ${p.pos}`);
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

test('falling far reports fall damage, water breaks the fall', () => {
  const w = flatWorld();
  const p = new Player();
  p.teleport(0.5, 30, 0.5);
  let damage = 0;
  for (let i = 0; i < 200; i++) damage += p.update(1 / 60, idle, w).fallDamage;
  assert.ok(damage >= 15 && damage <= 17, `took ${damage}`);

  w.setBlock(6, 11, 6, B.WATER);
  p.teleport(6.5, 30, 6.5);
  damage = 0;
  for (let i = 0; i < 200; i++) damage += p.update(1 / 60, idle, w).fallDamage;
  assert.equal(damage, 0);
});

test('ladders let the player climb', () => {
  const w = flatWorld();
  for (let y = 11; y < 16; y++) {
    w.setBlock(2, y, 0, B.STONE);
    w.setBlock(1, y, 0, B.LADDER_E ?? B.LADDER_W ?? B.LADDER_N ?? B.LADDER_S);
  }
  const p = new Player();
  p.teleport(1.5, 11, 0.5);
  p.yaw = -Math.PI / 2;
  for (let i = 0; i < 120; i++) p.update(1 / 60, { ...idle, forward: 1 }, w);
  assert.ok(p.pos[1] > 12.5, `climbed to ${p.pos[1]}`);
});

test('vertices carry shader flags: water ripples, leaves and plant tops sway', async () => {
  const { FLAG_SCROLL, FLAG_WATER, FLAG_LEAVES, FLAG_PLANT, FLAG_TOP } = await import('../src/mesher.js');
  const flagsOf = (buffer) => {
    const i16 = new Int16Array(buffer);
    const out = [];
    for (let v = 0; v < i16.length / 8; v++) out.push(i16[v * 8 + 3]);
    return out;
  };
  const water = flagsOf(buildChunkMesh(regionWith([[4, 40, 4, B.WATER]])).water);
  assert.ok(water.length && water.every((f) => f === (FLAG_SCROLL | FLAG_WATER)));
  const lava = flagsOf(buildChunkMesh(regionWith([[4, 40, 4, B.LAVA]])).solid);
  assert.ok(lava.length && lava.every((f) => f === FLAG_SCROLL));
  const leaves = flagsOf(buildChunkMesh(regionWith([[4, 40, 4, B.OAK_LEAVES]])).solid);
  assert.ok(leaves.length && leaves.every((f) => f === FLAG_LEAVES));
  // Plants: only the top corners move.
  const plantMesh = buildChunkMesh(regionWith([[4, 40, 4, B.TALL_GRASS]])).solid;
  const i16 = new Int16Array(plantMesh);
  for (let v = 0; v < i16.length / 8; v++) {
    const top = i16[v * 8 + 1] === 41 * 16;
    assert.equal(i16[v * 8 + 3], FLAG_PLANT | (top ? FLAG_TOP : 0));
  }
  // Fire and stone stay still.
  assert.ok(flagsOf(buildChunkMesh(regionWith([[4, 40, 4, B.FIRE]])).solid).every((f) => f === 0));
  assert.ok(flagsOf(buildChunkMesh(regionWith([[4, 40, 4, B.STONE]])).solid).every((f) => f === 0));
});

test('the shader pipeline sources assemble', async () => {
  const FX = await import('../src/shaders.js');
  for (const key of ['TERRAIN_VS', 'TERRAIN_FS', 'SHADOW_VS', 'SHADOW_FS', 'ENTITY_FS', 'SKY_FS', 'COMPOSITE_FS', 'RAYS_FS', 'BLUR_FS', 'BRIGHT_FS']) {
    assert.ok(FX[key].startsWith('#version 300 es'), key);
    assert.equal((FX[key].match(/\{/g) ?? []).length, (FX[key].match(/\}/g) ?? []).length, `${key} braces balance`);
  }
});
