// Keeps the world loaded around the camera: asks workers to generate chunks,
// meshes the ones whose neighbours are all present, uploads the results and
// frees whatever has drifted out of range.
import { CHUNK } from './terrain.js';
import { chunkKey } from './world.js';
import { createJobRunner } from './jobs.js';

const MAX_INFLIGHT = 2;

// Runs jobs on the main thread in small time slices when Web Workers are unavailable.
class InlineWorker {
  constructor() {
    this.run = createJobRunner();
    this.queue = [];
    this.timer = null;
    this.onmessage = null;
  }

  postMessage(msg) {
    this.queue.push(msg);
    if (!this.timer) this.timer = setTimeout(() => this.drain(), 0);
  }

  drain() {
    this.timer = null;
    const start = performance.now();
    while (this.queue.length && performance.now() - start < 8) {
      const msg = this.queue.shift();
      let reply;
      try {
        reply = this.run(msg).reply;
      } catch (err) {
        reply = { type: 'error', id: msg.id, message: String(err) };
      }
      this.onmessage?.({ data: reply });
    }
    if (this.queue.length) this.timer = setTimeout(() => this.drain(), 0);
  }

  terminate() {
    this.queue = [];
  }
}

const offsetCache = new Map();
function offsetsWithin(radius) {
  if (!offsetCache.has(radius)) {
    const list = [];
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= r2) list.push([dx, dz, dx * dx + dz * dz]);
      }
    }
    list.sort((a, b) => a[2] - b[2]);
    offsetCache.set(radius, list);
  }
  return offsetCache.get(radius);
}

export class Streamer {
  constructor(renderer) {
    this.renderer = renderer;
    this.world = null;
    this.epoch = 0;
    this.slots = [];
    this.jobs = new Map();
    this.nextId = 1;
    this.radius = 6;
    this.center = null;
    this.order = [];
    this.inline = false;
    this.spawnWorkers();
  }

  spawnWorkers() {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        this.attach(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
      }
    } catch (err) {
      console.warn('Web Workers unavailable, generating on the main thread.', err);
      this.useInline();
    }
  }

  attach(worker) {
    const slot = { worker, inflight: 0 };
    worker.onmessage = (e) => this.onResult(slot, e.data);
    worker.onerror = (e) => {
      console.warn('A worker failed to start, generating on the main thread.', e.message || e);
      this.useInline();
    };
    this.slots.push(slot);
    if (this.world) worker.postMessage({ type: 'init', seed: this.world.seed, epoch: this.epoch });
  }

  useInline() {
    if (this.inline) return;
    this.inline = true;
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.forgetPending();
    this.attach(new InlineWorker());
  }

  // Drop every in-flight job; the next update re-requests what is still needed.
  forgetPending() {
    this.jobs.clear();
    for (const slot of this.slots) slot.inflight = 0;
    if (!this.world) return;
    for (const c of this.world.chunks.values()) {
      c.genPending = false;
      c.meshPending = false;
    }
  }

  setWorld(world) {
    if (this.world) {
      for (const c of this.world.chunks.values()) this.renderer.deleteChunkMesh(c);
    }
    this.world = world;
    this.epoch++;
    this.center = null;
    for (const slot of this.slots) slot.worker.postMessage({ type: 'init', seed: world.seed, epoch: this.epoch });
  }

  update(px, pz, radius) {
    const world = this.world;
    if (!world) return;
    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);
    if (!this.center || radius !== this.radius || cx !== this.center[0] || cz !== this.center[1]) {
      this.radius = radius;
      this.center = [cx, cz];
      this.refresh();
    }
    this.pump();
  }

  refresh() {
    const world = this.world;
    const [cx, cz] = this.center;
    const dataRadius = this.radius + 1;
    this.order = [];
    for (const c of world.chunks.values()) c.visible = false;
    for (const [dx, dz] of offsetsWithin(dataRadius)) {
      const key = chunkKey(cx + dx, cz + dz);
      let c = world.chunks.get(key);
      if (!c) {
        c = {
          key, cx: cx + dx, cz: cz + dz, blocks: null, gpu: null,
          version: 0, meshedVersion: -1, urgent: 0, genPending: false, meshPending: false,
        };
        world.chunks.set(key, c);
      }
      c.visible = dx * dx + dz * dz <= (this.radius + 0.5) * (this.radius + 0.5);
      this.order.push(c);
    }
    const keep = (dataRadius + 2) * (dataRadius + 2);
    for (const c of world.chunks.values()) {
      const dx = c.cx - cx;
      const dz = c.cz - cz;
      if (dx * dx + dz * dz > keep) {
        this.renderer.deleteChunkMesh(c);
        world.chunks.delete(c.key);
      }
    }
  }

  needsMesh(c) {
    return c.visible && c.blocks && !c.meshPending && c.version !== c.meshedVersion &&
      this.world.neighboursReady(c.cx, c.cz);
  }

  pump() {
    if (!this.hasCapacity()) return;
    // Edits first so breaking and placing feel instant, then nearest-first loading.
    for (let level = 2; level >= 1; level--) {
      for (const c of this.world.chunks.values()) {
        if (c.urgent >= level && this.needsMesh(c) && !this.requestMesh(c)) return;
      }
    }
    for (const c of this.order) {
      if (!c.blocks && !c.genPending) {
        if (!this.requestGen(c)) return;
      } else if (this.needsMesh(c)) {
        if (!this.requestMesh(c)) return;
      }
    }
  }

  hasCapacity() {
    return this.slots.some((s) => s.inflight < MAX_INFLIGHT);
  }

  dispatch(job, transfer) {
    let best = null;
    for (const s of this.slots) {
      if (s.inflight < MAX_INFLIGHT && (!best || s.inflight < best.inflight)) best = s;
    }
    if (!best) return false;
    job.id = this.nextId++;
    job.epoch = this.epoch;
    best.inflight++;
    this.jobs.set(job.id, { type: job.type, key: job.key });
    best.worker.postMessage(job, transfer);
    return true;
  }

  requestGen(c) {
    if (!this.dispatch({ type: 'gen', key: c.key, cx: c.cx, cz: c.cz }, [])) return false;
    c.genPending = true;
    return true;
  }

  requestMesh(c) {
    const region = this.world.buildRegion(c.cx, c.cz);
    const job = { type: 'mesh', key: c.key, version: c.version, region: region.buffer };
    if (!this.dispatch(job, [region.buffer])) return false;
    c.meshPending = true;
    return true;
  }

  onResult(slot, msg) {
    if (msg.type === 'ready') return;
    slot.inflight = Math.max(0, slot.inflight - 1);
    const job = this.jobs.get(msg.id);
    this.jobs.delete(msg.id);
    if (msg.type === 'error') {
      console.error('Chunk job failed:', msg.message);
      const c = job && this.world?.chunks.get(job.key);
      if (c) { c.genPending = false; c.meshPending = false; }
      return;
    }
    if (msg.epoch !== this.epoch || !this.world) return;
    const c = this.world.chunks.get(msg.key);
    if (!c) return;
    if (msg.type === 'gen') {
      c.genPending = false;
      this.world.acceptChunk(c, msg.blocks);
    } else if (msg.type === 'mesh') {
      c.meshPending = false;
      if (msg.version < c.meshedVersion) return;
      this.renderer.uploadChunkMesh(c, msg.mesh);
      c.meshedVersion = msg.version;
      if (c.version === msg.version) c.urgent = 0;
    }
  }

  // Fraction of the chunks within `radius` of (x, z) that are drawable.
  progress(x, z, radius) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    let total = 0;
    let done = 0;
    for (const [dx, dz] of offsetsWithin(radius)) {
      total++;
      const c = this.world?.getChunk(cx + dx, cz + dz);
      if (c && c.meshedVersion >= 0) done++;
    }
    return done / total;
  }

  get pendingJobs() {
    return this.jobs.size;
  }
}
