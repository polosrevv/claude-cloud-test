// Work that runs off the main thread: terrain generation and meshing. The
// same runner backs real Web Workers and the in-page fallback.
import { createTerrain } from './terrain.js';
import { buildChunkMesh } from './mesher.js';

export function createJobRunner() {
  let seed = 0;
  const terrains = new Map();
  const terrainFor = (dimension) => {
    if (!terrains.has(dimension)) terrains.set(dimension, createTerrain(seed, dimension));
    return terrains.get(dimension);
  };
  return function run(msg) {
    switch (msg.type) {
      case 'init':
        seed = msg.seed;
        terrains.clear();
        return { reply: { type: 'ready', epoch: msg.epoch } };
      case 'gen': {
        const blocks = terrainFor(msg.dimension).generateChunk(msg.cx, msg.cz);
        return { reply: { ...msg, blocks }, transfer: [blocks.buffer] };
      }
      case 'mesh': {
        const mesh = buildChunkMesh(new Uint8Array(msg.region), msg.skyLight);
        const reply = { ...msg, region: null, mesh };
        return { reply, transfer: [mesh.solid, mesh.water, mesh.light] };
      }
      default:
        throw new Error(`Unknown job ${msg.type}`);
    }
  };
}
