// Work that runs off the main thread: terrain generation and meshing. The
// same runner backs real Web Workers and the in-page fallback.
import { createTerrain } from './terrain.js';
import { buildChunkMesh } from './mesher.js';

export function createJobRunner() {
  let terrain = null;
  return function run(msg) {
    switch (msg.type) {
      case 'init':
        terrain = createTerrain(msg.seed);
        return { reply: { type: 'ready', epoch: msg.epoch } };
      case 'gen': {
        const blocks = terrain.generateChunk(msg.cx, msg.cz);
        return { reply: { ...msg, blocks }, transfer: [blocks.buffer] };
      }
      case 'mesh': {
        const mesh = buildChunkMesh(new Uint8Array(msg.region));
        const reply = { ...msg, region: null, mesh };
        return { reply, transfer: [mesh.solid, mesh.water] };
      }
      default:
        throw new Error(`Unknown job ${msg.type}`);
    }
  };
}
