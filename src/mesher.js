// Turns a chunk (plus a border of its neighbours) into vertex data.
//
// Input is a "region": the 16x16 chunk with PAD blocks of the surrounding
// chunks on every side, and one extra layer below (bedrock) and above (air).
// The border lets light flood in from neighbours and lets faces and ambient
// occlusion at chunk edges match up without asking the world for anything.
//
// Output vertices are 16 bytes:
//   int16  x, y, z, pad    position in 1/16 block units, chunk-local
//   uint8  u, v, layer, -  texture coordinates (layer in the texture array)
//   uint8  sky, block, ao, shade   light levels * 16, AO 0..3, face shade 0..255
import { CHUNK, HEIGHT } from './terrain.js';
import { B, OPAQUE, RENDER_TYPE, RENDER, SELF_CULL, LEAVES, INSET, EMIT, ATTEN, FACE_TEX } from './blocks.js';

export const PAD = 8;
export const RW = CHUNK + PAD * 2;
export const RH = HEIGHT + 2;
const LAYER = RW * RW;
export const REGION_SIZE = LAYER * RH;

// Region index from region-local x/z (0..RW-1) and world y (-1..HEIGHT).
export const regionIndex = (x, y, z) => ((y + 1) * RW + z) * RW + x;

// Face order: +x, -x, +y, -y, +z, -z. Corners are listed counter-clockwise as
// seen from outside the block (bottom-left, bottom-right, top-right, top-left).
export const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 153 },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 153 },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 255 },
  { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], shade: 128 },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 204 },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 204 },
];
const UV_U = [0, 1, 1, 0];
const UV_V = [1, 1, 0, 0];
const AXIS_OFF = [1, LAYER, RW];
const DIR_OFF = FACES.map((f) => f.dir[0] * AXIS_OFF[0] + f.dir[1] * AXIS_OFF[1] + f.dir[2] * AXIS_OFF[2]);

// For each face and corner: region offsets of the two edge neighbours of the
// cell in front of the face, used for ambient occlusion and smooth lighting.
const SIDE1 = [];
const SIDE2 = [];
for (const face of FACES) {
  const normalAxis = face.dir.findIndex((v) => v !== 0);
  const [a1, a2] = [0, 1, 2].filter((a) => a !== normalAxis);
  SIDE1.push(face.corners.map((c) => (c[a1] ? 1 : -1) * AXIS_OFF[a1]));
  SIDE2.push(face.corners.map((c) => (c[a2] ? 1 : -1) * AXIS_OFF[a2]));
}

class MeshWriter {
  constructor() {
    this.capacity = 0;
    this.quads = 0;
    this.ensure(4096);
  }

  ensure(quads) {
    if (quads <= this.capacity) return;
    const cap = Math.max(quads, this.capacity * 2);
    const buf = new ArrayBuffer(cap * 64);
    const u8 = new Uint8Array(buf);
    if (this.u8) u8.set(this.u8.subarray(0, this.quads * 64));
    this.u8 = u8;
    this.i16 = new Int16Array(buf);
    this.capacity = cap;
  }

  take() {
    return this.u8.slice(0, this.quads * 64).buffer;
  }
}

const solidOut = new MeshWriter();
const waterOut = new MeshWriter();
const skyLight = new Uint8Array(REGION_SIZE);
const blockLight = new Uint8Array(REGION_SIZE);
const QUEUE_MASK = (1 << 19) - 1;
const queue = new Int32Array(QUEUE_MASK + 1);

// Scratch per quad.
const qPos = new Int16Array(12);
const qAo = new Uint8Array(4);
const qSky = new Uint8Array(4);
const qBlk = new Uint8Array(4);

function writeQuad(w, layer, shade) {
  w.ensure(w.quads + 1);
  // Pick the diagonal that keeps AO gradients symmetric.
  const flip = qAo[0] + qAo[2] < qAo[1] + qAo[3];
  const i16 = w.i16;
  const u8 = w.u8;
  let v = w.quads * 4;
  for (let k = 0; k < 4; k++, v++) {
    const c = flip ? (k + 1) & 3 : k;
    const s = v * 8;
    i16[s] = qPos[c * 3];
    i16[s + 1] = qPos[c * 3 + 1];
    i16[s + 2] = qPos[c * 3 + 2];
    i16[s + 3] = 0;
    const b = v * 16 + 8;
    u8[b] = UV_U[c];
    u8[b + 1] = UV_V[c];
    u8[b + 2] = layer;
    u8[b + 3] = 0;
    u8[b + 4] = qSky[c];
    u8[b + 5] = qBlk[c];
    u8[b + 6] = qAo[c];
    u8[b + 7] = shade;
  }
  w.quads++;
}

// Breadth-first flood fill: each step into a non-opaque cell costs 1 plus that
// block's attenuation (leaves 1, water 2).
function propagate(region, light, head, tail) {
  while (head !== tail) {
    const i = queue[head];
    head = (head + 1) & QUEUE_MASK;
    const l = light[i];
    if (l <= 1) continue;
    const x = i % RW;
    const zy = (i - x) / RW;
    const z = zy % RW;
    const y = (zy - z) / RW;
    for (let f = 0; f < 6; f++) {
      if ((f === 0 && x === RW - 1) || (f === 1 && x === 0) || (f === 2 && y === RH - 1) ||
          (f === 3 && y === 0) || (f === 4 && z === RW - 1) || (f === 5 && z === 0)) continue;
      const n = i + DIR_OFF[f];
      const id = region[n];
      if (OPAQUE[id]) continue;
      const nl = l - 1 - ATTEN[id];
      if (nl > light[n]) {
        light[n] = nl;
        queue[tail] = n;
        tail = (tail + 1) & QUEUE_MASK;
      }
    }
  }
}

export function computeLight(region) {
  const sky = skyLight;
  const blk = blockLight;
  blk.fill(0);

  // Sunlight falls straight down at full strength until something blocks it.
  let top = 0;
  for (let z = 0; z < RW; z++) {
    for (let x = 0; x < RW; x++) {
      let l = 15;
      for (let y = RH - 1; y >= 0; y--) {
        const i = (y * RW + z) * RW + x;
        const id = region[i];
        if (id !== B.AIR && y > top) top = y;
        if (l > 0) l = OPAQUE[id] ? 0 : Math.max(0, l - ATTEN[id]);
        sky[i] = l;
      }
    }
  }

  // Then it spreads sideways into overhangs and caves. Seed the fill with lit
  // cells that border a darker open cell.
  let tail = 0;
  const maxY = Math.min(top + 1, RH - 1);
  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        const i = (y * RW + z) * RW + x;
        const l = sky[i];
        if (l < 2) continue;
        const t = l - 1;
        if ((x > 0 && sky[i - 1] < t && !OPAQUE[region[i - 1]]) ||
            (x < RW - 1 && sky[i + 1] < t && !OPAQUE[region[i + 1]]) ||
            (z > 0 && sky[i - RW] < t && !OPAQUE[region[i - RW]]) ||
            (z < RW - 1 && sky[i + RW] < t && !OPAQUE[region[i + RW]]) ||
            (y > 0 && sky[i - LAYER] < t && !OPAQUE[region[i - LAYER]])) {
          queue[tail] = i;
          tail = (tail + 1) & QUEUE_MASK;
        }
      }
    }
  }
  propagate(region, sky, 0, tail);

  // Light-emitting blocks.
  tail = 0;
  for (let i = 0; i < REGION_SIZE; i++) {
    const e = EMIT[region[i]];
    if (e) {
      blk[i] = e;
      queue[tail] = i;
      tail = (tail + 1) & QUEUE_MASK;
    }
  }
  propagate(region, blk, 0, tail);
  return { sky, blk };
}

function cubeFaces(region, sky, blk, i, px, py, pz, id, out) {
  if (LEAVES[id]) {
    // Leaves buried inside a canopy can never be seen; skip all six faces.
    let buried = true;
    for (let f = 0; f < 6; f++) {
      const n = region[i + DIR_OFF[f]];
      if (!OPAQUE[n] && !LEAVES[n]) { buried = false; break; }
    }
    if (buried) return;
  }
  const inset = INSET[id];
  const emissive = EMIT[id] > 0;
  for (let f = 0; f < 6; f++) {
    const o = i + DIR_OFF[f];
    const n = region[o];
    const sideInset = inset && f !== 2 && f !== 3;
    if (!sideInset) {
      if (OPAQUE[n]) continue;
      if (n === id && SELF_CULL[id]) continue;
    }
    const face = FACES[f];
    const s1 = SIDE1[f];
    const s2 = SIDE2[f];
    const openFront = !OPAQUE[n];
    for (let c = 0; c < 4; c++) {
      const a = o + s1[c];
      const b = o + s2[c];
      const d = a + s2[c];
      const oa = OPAQUE[region[a]];
      const ob = OPAQUE[region[b]];
      const od = OPAQUE[region[d]];
      qAo[c] = oa && ob ? 0 : 3 - (oa + ob + od);
      // Smooth lighting: average the open cells touching this corner.
      let sl = openFront ? sky[o] : sky[i];
      let bl = openFront ? blk[o] : blk[i];
      let cnt = 1;
      if (!oa) { sl += sky[a]; bl += blk[a]; cnt++; }
      if (!ob) { sl += sky[b]; bl += blk[b]; cnt++; }
      if (!od && !(oa && ob)) { sl += sky[d]; bl += blk[d]; cnt++; }
      qSky[c] = ((sl * 16) / cnt) | 0;
      qBlk[c] = emissive ? 240 : ((bl * 16) / cnt) | 0;
      const corner = face.corners[c];
      qPos[c * 3] = (px + corner[0]) * 16 - (sideInset ? face.dir[0] : 0);
      qPos[c * 3 + 1] = (py + corner[1]) * 16;
      qPos[c * 3 + 2] = (pz + corner[2]) * 16 - (sideInset ? face.dir[2] : 0);
    }
    writeQuad(out, FACE_TEX[id * 6 + f], face.shade);
  }
}

function liquidFaces(region, sky, blk, i, px, py, pz, id, out) {
  const surface = region[i + LAYER] === id ? 16 : 14;
  for (let f = 0; f < 6; f++) {
    const o = i + DIR_OFF[f];
    const n = region[o];
    if (n === id || OPAQUE[n]) continue;
    const face = FACES[f];
    const sl = sky[o] * 16;
    const bl = blk[o] * 16;
    for (let c = 0; c < 4; c++) {
      const corner = face.corners[c];
      qPos[c * 3] = (px + corner[0]) * 16;
      qPos[c * 3 + 1] = py * 16 + corner[1] * surface;
      qPos[c * 3 + 2] = (pz + corner[2]) * 16;
      qAo[c] = 3;
      qSky[c] = sl;
      qBlk[c] = bl;
    }
    writeQuad(out, FACE_TEX[id * 6 + f], face.shade);
  }
}

// Two crossed planes, each written front and back so no face culling is needed.
const CROSS = [
  [1, 1, 15, 15], [15, 15, 1, 1],
  [1, 15, 15, 1], [15, 1, 1, 15],
];
function crossFaces(region, sky, blk, i, px, py, pz, id, out) {
  const layer = FACE_TEX[id * 6];
  const sl = sky[i] * 16;
  const bl = blk[i] * 16;
  for (const [x0, z0, x1, z1] of CROSS) {
    const pts = [[x0, 0, z0], [x1, 0, z1], [x1, 16, z1], [x0, 16, z0]];
    for (let c = 0; c < 4; c++) {
      qPos[c * 3] = px * 16 + pts[c][0];
      qPos[c * 3 + 1] = py * 16 + pts[c][1];
      qPos[c * 3 + 2] = pz * 16 + pts[c][2];
      qAo[c] = 3;
      qSky[c] = sl;
      qBlk[c] = bl;
    }
    writeQuad(out, layer, 216);
  }
}

function emitBlock(region, sky, blk, i, px, py, pz, id) {
  switch (RENDER_TYPE[id]) {
    case RENDER.CUBE: cubeFaces(region, sky, blk, i, px, py, pz, id, solidOut); break;
    case RENDER.CROSS: crossFaces(region, sky, blk, i, px, py, pz, id, solidOut); break;
    case RENDER.LIQUID: liquidFaces(region, sky, blk, i, px, py, pz, id, waterOut); break;
    default: break;
  }
}

export function buildChunkMesh(region) {
  const { sky, blk } = computeLight(region);
  solidOut.quads = 0;
  waterOut.quads = 0;
  let minY = HEIGHT;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y++) {
    const before = solidOut.quads + waterOut.quads;
    for (let z = 0; z < CHUNK; z++) {
      let i = regionIndex(PAD, y, z + PAD);
      for (let x = 0; x < CHUNK; x++, i++) {
        const id = region[i];
        if (id !== B.AIR) emitBlock(region, sky, blk, i, x, y, z, id);
      }
    }
    if (solidOut.quads + waterOut.quads > before) {
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return {
    solid: solidOut.take(),
    solidQuads: solidOut.quads,
    water: waterOut.take(),
    waterQuads: waterOut.quads,
    minY,
    maxY: maxY + 1,
  };
}

// A single, fully lit block centred on the origin's cell, for the held item.
export function buildItemMesh(id) {
  const region = new Uint8Array(REGION_SIZE);
  const i = regionIndex(PAD, 64, PAD);
  region[i] = id;
  skyLight.fill(15);
  blockLight.fill(0);
  solidOut.quads = 0;
  waterOut.quads = 0;
  emitBlock(region, skyLight, blockLight, i, 0, 0, 0, id);
  const water = RENDER_TYPE[id] === RENDER.LIQUID;
  return {
    data: water ? waterOut.take() : solidOut.take(),
    quads: water ? waterOut.quads : solidOut.quads,
  };
}
