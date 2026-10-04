// The main thread's copy of one dimension: loaded chunk data and light, player
// edits, block entities (chests, furnaces, spawners), parked entities and the
// bookkeeping that tells the streamer which chunks need new meshes.
import { CHUNK, HEIGHT, blockIndex } from './constants.js';
import { createTerrain, DIMENSIONS } from './terrain.js';
import { B, PLANT, FLUID } from './blocks.js';
import { PAD, RW, regionIndex, REGION_SIZE } from './mesher.js';

export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const posKey = (x, y, z) => `${x},${y},${z}`;

export class World {
  constructor(seed, dimension = 'overworld') {
    this.seed = seed;
    this.dimension = dimension;
    this.info = DIMENSIONS[dimension];
    this.terrain = createTerrain(seed, dimension);
    this.chunks = new Map();
    // Player edits survive chunk unloading: chunkKey -> Map(blockIndex -> id).
    this.edits = new Map();
    this.editCount = 0;
    // Chests, furnaces and spawners: "x,y,z" -> data.
    this.blockEntities = new Map();
    // Entities in chunks that unloaded: chunkKey -> [serialised entity].
    this.parked = new Map();
    // Chunks that have had their one-time population (animals, loot).
    this.populated = new Set();
    // Pending block ticks (flowing fluids): "x,y,z" -> tick due.
    this.scheduled = new Map();
    this.onChange = null;
    this.onChunkLoad = null;
    this.onChunkUnload = null;
  }

  makeChunk(cx, cz) {
    return {
      key: chunkKey(cx, cz), cx, cz, blocks: null, light: null, gpu: null,
      version: 0, meshedVersion: -1, urgent: 0, genPending: false, meshPending: false, visible: false,
    };
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  // Unloaded space reads as `fallback`: bedrock for physics so nothing falls
  // through the world before it loads, air for everything else.
  getBlock(x, y, z, fallback = B.AIR) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.blocks) return fallback;
    return chunk.blocks[blockIndex(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  isLoaded(x, z) {
    const chunk = this.getChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    return !!(chunk && chunk.blocks);
  }

  // Light from the last mesh of the chunk, packed sky << 4 | block. Unknown
  // places read as full sky light in dimensions with a sky.
  getLight(x, y, z) {
    if (y >= HEIGHT) return (this.info.skyLight << 4);
    if (y < 0) return 0;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.light) return this.info.skyLight << 4;
    return chunk.light[blockIndex(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  skyLightAt(x, y, z) {
    return this.getLight(x, y, z) >> 4;
  }

  blockLightAt(x, y, z) {
    return this.getLight(x, y, z) & 15;
  }

  // Store generated data and re-apply any edits the player made earlier.
  acceptChunk(chunk, blocks) {
    const edits = this.edits.get(chunk.key);
    if (edits) for (const [i, id] of edits) blocks[i] = id;
    chunk.blocks = blocks;
    this.onChunkLoad?.(chunk);
  }

  unloadChunk(chunk) {
    if (chunk.blocks) this.onChunkUnload?.(chunk);
    this.chunks.delete(chunk.key);
  }

  // Generate a chunk right now on the main thread (portals need the far side immediately).
  ensureChunk(cx, cz) {
    let c = this.getChunk(cx, cz);
    if (!c) {
      c = this.makeChunk(cx, cz);
      this.chunks.set(c.key, c);
    }
    if (!c.blocks) this.acceptChunk(c, this.terrain.generateChunk(cx, cz));
    return c;
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.blocks) return false;
    const i = blockIndex(x - cx * CHUNK, y, z - cz * CHUNK);
    const old = chunk.blocks[i];
    if (old === id) return false;
    chunk.blocks[i] = id;
    let edits = this.edits.get(chunk.key);
    if (!edits) this.edits.set(chunk.key, (edits = new Map()));
    if (!edits.has(i)) this.editCount++;
    edits.set(i, id);
    this.markDirty(x, z);
    this.onChange?.(x, y, z, old, id);
    return true;
  }

  // Any chunk whose padded region contains (x, z) has a stale mesh now: its
  // faces, ambient occlusion or light may have changed.
  markDirty(x, z) {
    const cx0 = Math.floor((x - PAD) / CHUNK);
    const cx1 = Math.floor((x + PAD) / CHUNK);
    const cz0 = Math.floor((z - PAD) / CHUNK);
    const cz1 = Math.floor((z + PAD) / CHUNK);
    const home = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.getChunk(cx, cz);
        if (!c) continue;
        c.version++;
        c.urgent = Math.max(c.urgent, c.key === home ? 2 : 1);
      }
    }
  }

  schedule(x, y, z, tick) {
    const key = posKey(x, y, z);
    const due = this.scheduled.get(key);
    if (due === undefined || tick < due) this.scheduled.set(key, tick);
  }

  // Highest block that stops a player, or -1.
  surfaceY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !PLANT[id] && !FLUID[id]) return y;
    }
    return -1;
  }

  neighboursReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || !c.blocks) return false;
      }
    }
    return true;
  }

  // Copy the chunk plus a PAD-wide border from its eight neighbours.
  buildRegion(cx, cz) {
    const region = new Uint8Array(REGION_SIZE);
    // The layer under the world is solid so bottom faces of y=0 are culled.
    region.fill(B.BEDROCK, 0, RW * RW);
    const wx0 = cx * CHUNK - PAD;
    const wz0 = cz * CHUNK - PAD;
    for (let rz = 0; rz < RW; rz++) {
      const wz = wz0 + rz;
      const ncz = Math.floor(wz / CHUNK);
      const lz = wz - ncz * CHUNK;
      let rx = 0;
      while (rx < RW) {
        const wx = wx0 + rx;
        const ncx = Math.floor(wx / CHUNK);
        const lx = wx - ncx * CHUNK;
        const run = Math.min(CHUNK - lx, RW - rx);
        const src = this.getChunk(ncx, ncz)?.blocks;
        if (src) {
          for (let y = 0; y < HEIGHT; y++) {
            const s = blockIndex(lx, y, lz);
            region.set(src.subarray(s, s + run), regionIndex(rx, y, rz));
          }
        }
        rx += run;
      }
    }
    return region;
  }

  serialize() {
    const edits = {};
    for (const [key, map] of this.edits) {
      if (map.size === 0) continue;
      const flat = [];
      for (const [i, id] of map) flat.push(i, id);
      edits[key] = flat;
    }
    return {
      edits,
      blockEntities: [...this.blockEntities.entries()],
      parked: [...this.parked.entries()],
      populated: [...this.populated],
    };
  }

  load(data) {
    this.edits.clear();
    this.editCount = 0;
    for (const key of Object.keys(data?.edits || {})) {
      const flat = data.edits[key];
      const map = new Map();
      for (let k = 0; k + 1 < flat.length; k += 2) map.set(flat[k], flat[k + 1]);
      this.edits.set(Number(key), map);
      this.editCount += map.size;
    }
    this.blockEntities = new Map(data?.blockEntities || []);
    this.parked = new Map(data?.parked || []);
    this.populated = new Set(data?.populated || []);
  }
}
