// The main thread's copy of the world: loaded chunk data, player edits, and
// the bookkeeping that tells the streamer which chunks need new meshes.
import { CHUNK, HEIGHT, blockIndex, createTerrain } from './terrain.js';
import { B, FALLS, PLANT } from './blocks.js';
import { PAD, RW, regionIndex, REGION_SIZE } from './mesher.js';

export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export class World {
  constructor(seed) {
    this.seed = seed;
    this.terrain = createTerrain(seed);
    this.chunks = new Map();
    // Player edits survive chunk unloading: chunkKey -> Map(blockIndex -> id).
    this.edits = new Map();
    this.editCount = 0;
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

  // Store generated data and re-apply any edits the player made earlier.
  acceptChunk(chunk, blocks) {
    const edits = this.edits.get(chunk.key);
    if (edits) for (const [i, id] of edits) blocks[i] = id;
    chunk.blocks = blocks;
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
        // The edited chunk itself is remeshed first; neighbours follow.
        c.urgent = Math.max(c.urgent, c.key === home ? 2 : 1);
      }
    }
  }

  // Break a block and apply the simple physics that follows: plants pop off,
  // sand and gravel fall. Returns the removed id, or null.
  breakBlock(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR || id === B.WATER) return null;
    if (y === 0) return null; // the bottom bedrock layer keeps the void out
    this.setBlock(x, y, z, B.AIR);
    const above = this.getBlock(x, y + 1, z);
    if (PLANT[above]) this.setBlock(x, y + 1, z, B.AIR);
    else if (FALLS[above]) this.settle(x, y + 1, z);
    return id;
  }

  placeBlock(x, y, z, id) {
    if (!this.setBlock(x, y, z, id)) return false;
    if (FALLS[id]) this.settle(x, y, z);
    return true;
  }

  // Drop a column of sand/gravel starting at (x, y, z) onto the first support.
  settle(x, y, z) {
    while (y < HEIGHT && FALLS[this.getBlock(x, y, z)]) {
      const id = this.getBlock(x, y, z);
      let to = y;
      while (to > 0) {
        const below = this.getBlock(x, to - 1, z);
        if (below !== B.AIR && below !== B.WATER && !PLANT[below]) break;
        to--;
      }
      if (to === y) return;
      this.setBlock(x, y, z, B.AIR);
      this.setBlock(x, to, z, id);
      y++;
    }
  }

  // Highest block that stops a player, or -1.
  surfaceY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !PLANT[id] && id !== B.WATER) return y;
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

  serializeEdits() {
    const out = {};
    for (const [key, edits] of this.edits) {
      if (edits.size === 0) continue;
      const flat = [];
      for (const [i, id] of edits) flat.push(i, id);
      out[key] = flat;
    }
    return out;
  }

  loadEdits(data) {
    this.edits.clear();
    this.editCount = 0;
    for (const key of Object.keys(data || {})) {
      const flat = data[key];
      const edits = new Map();
      for (let k = 0; k + 1 < flat.length; k += 2) edits.set(flat[k], flat[k + 1]);
      this.edits.set(Number(key), edits);
      this.editCount += edits.size;
    }
  }
}
