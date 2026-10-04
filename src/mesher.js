// Turns a chunk (plus a border of its neighbours) into vertex data.
//
// Input is a "region": the 16x16 chunk with PAD blocks of the surrounding
// chunks on every side, and one extra layer below (bedrock) and above (air).
// The border lets light flood in from neighbours and lets faces and ambient
// occlusion at chunk edges match up without asking the world for anything.
//
// Output vertices are 16 bytes:
//   int16  x, y, z, flags         position in 1/16 block units, chunk-local; flags are the FLAG_* bits below
//   uint8  u, v, layerLo, layerHi texture coordinates in 1/16 of a tile, layer in the texture array
//   uint8  sky, block, ao, shade  light levels * 16, AO 0..3, face shade 0..255
import { CHUNK, HEIGHT } from './constants.js';
import {
  B, BLOCKS, BLOCK_COUNT, OPAQUE, RENDER_TYPE, RENDER, SELF_CULL, LEAVES, INSET, EMIT, ATTEN, FACE_TEX,
  TRANSLUCENT, FLUID, FLUID_LEVEL, MODELS, SCROLL, CONNECT, connectMask, connectModel,
} from './blocks.js';

// Vertex flags, read by the shaders: scrolling liquid textures, water to
// ripple and reflect, leaves and plants that sway in the wind (plants only
// at their tops).
export const FLAG_SCROLL = 1;
export const FLAG_WATER = 2;
export const FLAG_LEAVES = 4;
export const FLAG_PLANT = 8;
export const FLAG_TOP = 16;
const SWAY = new Uint8Array(BLOCK_COUNT);
for (let id = 1; id < BLOCK_COUNT; id++) {
  const key = BLOCKS[id].key;
  if (LEAVES[id]) SWAY[id] = FLAG_LEAVES;
  else if (RENDER_TYPE[id] === RENDER.CROSS && key !== 'fire' && !key.endsWith('mushroom') && !key.startsWith('nether_wart')) SWAY[id] = FLAG_PLANT;
}

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
const UV_U = [0, 16, 16, 0];
const UV_V = [16, 16, 0, 0];
const AXIS_OFF = [1, LAYER, RW];
const DIR_OFF = FACES.map((f) => f.dir[0] * AXIS_OFF[0] + f.dir[1] * AXIS_OFF[1] + f.dir[2] * AXIS_OFF[2]);

// Texture coordinates of a point on a face, in 1/16 units, so that sub-block
// boxes show the matching part of the tile.
export function faceUV(f, x, y, z) {
  switch (f) {
    case 0: return [16 - z, 16 - y];
    case 1: return [z, 16 - y];
    case 2: return [x, z];
    case 3: return [16 - x, z];
    case 4: return [x, 16 - y];
    default: return [16 - x, 16 - y];
  }
}

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
const qU = new Uint8Array(4);
const qV = new Uint8Array(4);
const qAo = new Uint8Array(4);
const qSky = new Uint8Array(4);
const qBlk = new Uint8Array(4);

function setStandardUV() {
  for (let c = 0; c < 4; c++) { qU[c] = UV_U[c]; qV[c] = UV_V[c]; }
}

// top: a bit per corner that gets FLAG_TOP (the swaying tops of plants).
function writeQuad(w, layer, shade, flags = 0, top = 0) {
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
    i16[s + 3] = (top >> c) & 1 ? flags | FLAG_TOP : flags;
    const b = v * 16 + 8;
    u8[b] = qU[c];
    u8[b + 1] = qV[c];
    u8[b + 2] = layer & 255;
    u8[b + 3] = layer >> 8;
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

// skyTop: 15 for dimensions with a sky, 0 for the Nether and the End.
export function computeLight(region, skyTop = 15) {
  const sky = skyLight;
  const blk = blockLight;
  blk.fill(0);
  sky.fill(0);

  let top = 0;
  for (let z = 0; z < RW; z++) {
    for (let x = 0; x < RW; x++) {
      let l = skyTop;
      for (let y = RH - 1; y >= 0; y--) {
        const i = (y * RW + z) * RW + x;
        const id = region[i];
        if (id !== B.AIR && y > top) top = y;
        if (l > 0) l = OPAQUE[id] ? 0 : Math.max(0, l - ATTEN[id]);
        sky[i] = l;
      }
    }
  }

  if (skyTop > 0) {
    // Sunlight spreads sideways into overhangs and caves. Seed the fill with
    // lit cells that border a darker open cell.
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
  }

  let tail = 0;
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
  setStandardUV();
  for (let f = 0; f < 6; f++) {
    const o = i + DIR_OFF[f];
    const n = region[o];
    const sideInset = inset && f !== 2 && f !== 3;
    if (!sideInset) {
      if (OPAQUE[n]) continue;
      if (n === id && SELF_CULL[id]) continue;
      if (TRANSLUCENT[id] && TRANSLUCENT[n] && SELF_CULL[id]) continue;
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
    writeQuad(out, FACE_TEX[id * 6 + f], face.shade, SWAY[id]);
  }
}

// Box models (torches, doors, beds, slabs...). Faces on the block boundary are
// culled against opaque neighbours; inner faces always draw.
function modelFaces(region, sky, blk, i, px, py, pz, id, out, boxes = MODELS[id]) {
  const emissive = EMIT[id] > 0;
  const flags = SCROLL[id] ? 1 : 0;
  for (const box of boxes) {
    const [x0, y0, z0] = box.from;
    const [x1, y1, z1] = box.to;
    const lo = [Math.min(x0, x1), y0, Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), y1, Math.max(z0, z1)];
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const axis = face.dir.findIndex((v) => v !== 0);
      const positive = face.dir[axis] > 0;
      const onBoundary = positive ? hi[axis] === 16 : lo[axis] === 0;
      const o = i + DIR_OFF[f];
      if (onBoundary && OPAQUE[region[o]]) continue;
      const lit = onBoundary && !OPAQUE[region[o]] ? o : i;
      const sl = Math.max(sky[lit], sky[i]) * 16;
      const bl = emissive ? 240 : Math.max(blk[lit], blk[i]) * 16;
      const uvRect = box.uv?.[f];
      for (let c = 0; c < 4; c++) {
        const corner = face.corners[c];
        let x = corner[0] ? hi[0] : lo[0];
        const y = corner[1] ? hi[1] : lo[1];
        let z = corner[2] ? hi[2] : lo[2];
        if (box.shear && y > lo[1]) {
          const k = (y - lo[1]) / (hi[1] - lo[1]);
          x += Math.round(box.shear[0] * k);
          z += Math.round(box.shear[1] * k);
        }
        qPos[c * 3] = px * 16 + x;
        qPos[c * 3 + 1] = py * 16 + y;
        qPos[c * 3 + 2] = pz * 16 + z;
        if (uvRect) {
          qU[c] = UV_U[c] ? uvRect[2] : uvRect[0];
          qV[c] = UV_V[c] ? uvRect[3] : uvRect[1];
        } else {
          let ux = corner[0] ? hi[0] : lo[0];
          let uz = corner[2] ? hi[2] : lo[2];
          // Rotated models turn their top and bottom textures with them.
          if ((f === 2 || f === 3) && box.rot) {
            for (let t = 0; t < box.rot; t++) [ux, uz] = [uz, 16 - ux];
          }
          const [u, v] = faceUV(f, ux, corner[1] ? hi[1] : lo[1], uz);
          qU[c] = u;
          qV[c] = v;
        }
        qAo[c] = 3;
        qSky[c] = sl;
        qBlk[c] = bl;
      }
      writeQuad(out, box.layers[f], face.shade, flags);
    }
  }
}

// Height of the fluid surface in a cell, in 1/16 units (-1 when not this fluid).
function fluidHeight(region, i, type) {
  const id = region[i];
  if (FLUID[id] !== type) return -1;
  if (FLUID[region[i + LAYER]] === type) return 16;
  const level = FLUID_LEVEL[id];
  return level === 0 || level === 8 ? 14 : Math.max(2, 14 - level * 1.7);
}

// Corner height: average of the fluid cells around the corner, pulled down by
// open neighbours so flowing water slopes away from its source.
function cornerHeight(region, i, type, cx, cz) {
  let total = 0;
  let weight = 0;
  for (let dz = cz - 1; dz <= cz; dz++) {
    for (let dx = cx - 1; dx <= cx; dx++) {
      const n = i + dx + dz * RW;
      const h = fluidHeight(region, n, type);
      if (h === 16) return 16;
      if (h >= 0) {
        const w = FLUID_LEVEL[region[n]] === 0 ? 10 : 1;
        total += h * w;
        weight += w;
      } else if (!OPAQUE[region[n]]) {
        weight += 1;
      }
    }
  }
  return weight ? Math.round(total / weight) : 14;
}

const cornerH = new Int16Array(4);
function liquidFaces(region, sky, blk, i, px, py, pz, id, out) {
  const type = FLUID[id];
  const full = FLUID[region[i + LAYER]] === type;
  // Top corner heights indexed by (x, z): 0 = (0,0), 1 = (1,0), 2 = (0,1), 3 = (1,1).
  if (full) {
    cornerH.fill(16);
  } else {
    cornerH[0] = cornerHeight(region, i, type, 0, 0);
    cornerH[1] = cornerHeight(region, i, type, 1, 0);
    cornerH[2] = cornerHeight(region, i, type, 0, 1);
    cornerH[3] = cornerHeight(region, i, type, 1, 1);
  }
  const emissive = EMIT[id] > 0;
  setStandardUV();
  for (let f = 0; f < 6; f++) {
    const o = i + DIR_OFF[f];
    const n = region[o];
    if (FLUID[n] === type || OPAQUE[n]) continue;
    if (f === 2 && full) continue;
    const face = FACES[f];
    const sl = Math.max(sky[o], sky[i]) * 16;
    const bl = emissive ? 240 : Math.max(blk[o], blk[i]) * 16;
    for (let c = 0; c < 4; c++) {
      const corner = face.corners[c];
      qPos[c * 3] = (px + corner[0]) * 16;
      qPos[c * 3 + 1] = py * 16 + (corner[1] ? cornerH[corner[0] + corner[2] * 2] : 0);
      qPos[c * 3 + 2] = (pz + corner[2]) * 16;
      qAo[c] = 3;
      qSky[c] = sl;
      qBlk[c] = bl;
    }
    writeQuad(out, FACE_TEX[id * 6 + f], face.shade, type === 1 ? FLAG_SCROLL | FLAG_WATER : FLAG_SCROLL);
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
  const bl = EMIT[id] ? 240 : blk[i] * 16;
  setStandardUV();
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
    writeQuad(out, layer, 216, SWAY[id], SWAY[id] ? 0b1100 : 0);
  }
}

// itemMask: for icons, a fixed connection mask (an east-west fence or pane).
function emitBlock(region, sky, blk, i, px, py, pz, id, itemMask = null) {
  const out = TRANSLUCENT[id] ? waterOut : solidOut;
  switch (RENDER_TYPE[id]) {
    case RENDER.CUBE: cubeFaces(region, sky, blk, i, px, py, pz, id, out); break;
    case RENDER.CROSS: crossFaces(region, sky, blk, i, px, py, pz, id, out); break;
    case RENDER.LIQUID: liquidFaces(region, sky, blk, i, px, py, pz, id, out); break;
    case RENDER.MODEL:
      if (CONNECT[id]) {
        // Fences and panes: arms toward whichever neighbours they join.
        const mask = itemMask ?? connectMask(id, (dx, dz) => region[i + dx + dz * RW]);
        modelFaces(region, sky, blk, i, px, py, pz, id, out, connectModel(id, mask));
      } else {
        modelFaces(region, sky, blk, i, px, py, pz, id, out);
      }
      break;
    default: break;
  }
}

// Returns the vertex buffers plus the chunk's own light, packed sky << 4 | block.
export function buildChunkMesh(region, skyTop = 15) {
  const { sky, blk } = computeLight(region, skyTop);
  solidOut.quads = 0;
  waterOut.quads = 0;
  let minY = HEIGHT;
  let maxY = -1;
  const light = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const before = solidOut.quads + waterOut.quads;
    for (let z = 0; z < CHUNK; z++) {
      let i = regionIndex(PAD, y, z + PAD);
      let li = (y * CHUNK + z) * CHUNK;
      for (let x = 0; x < CHUNK; x++, i++, li++) {
        light[li] = (sky[i] << 4) | blk[i];
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
    light: light.buffer,
    minY,
    maxY: maxY + 1,
  };
}

// A single, fully lit block for held items, dropped items and icons.
export function buildBlockItemMesh(id) {
  const region = new Uint8Array(REGION_SIZE);
  const i = regionIndex(PAD, 64, PAD);
  region[i] = id;
  skyLight.fill(15);
  blockLight.fill(0);
  solidOut.quads = 0;
  waterOut.quads = 0;
  emitBlock(region, skyLight, blockLight, i, 0, 0, 0, id, 2 | 8);
  const water = TRANSLUCENT[id] === 1;
  return {
    data: water ? waterOut.take() : solidOut.take(),
    quads: water ? waterOut.quads : solidOut.quads,
    translucent: water,
  };
}

// A flat sprite given thickness, like Minecraft's held tools: front and back
// faces plus an edge face for every opaque pixel that borders a clear one.
export function buildSpriteMesh(layer, alpha) {
  const w = solidOut;
  w.quads = 0;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && alpha[(y * 16 + x) * 4 + 3] > 127;
  const quad = (pts, uvs, shade) => {
    for (let c = 0; c < 4; c++) {
      qPos[c * 3] = pts[c][0];
      qPos[c * 3 + 1] = pts[c][1];
      qPos[c * 3 + 2] = pts[c][2];
      qU[c] = uvs[c][0];
      qV[c] = uvs[c][1];
      qAo[c] = 3;
      qSky[c] = 240;
      qBlk[c] = 0;
    }
    writeQuad(w, layer, shade);
  };
  const z0 = 7;
  const z1 = 8;
  quad([[0, 0, z1], [16, 0, z1], [16, 16, z1], [0, 16, z1]], [[0, 16], [16, 16], [16, 0], [0, 0]], 255);
  quad([[16, 0, z0], [0, 0, z0], [0, 16, z0], [16, 16, z0]], [[16, 16], [0, 16], [0, 0], [16, 0]], 204);
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (!opaque(px, py)) continue;
      const x0 = px;
      const x1 = px + 1;
      const yTop = 16 - py;
      const yBot = 15 - py;
      const uv = [[px, py + 1], [px + 1, py + 1], [px + 1, py], [px, py]];
      if (!opaque(px - 1, py)) quad([[x0, yBot, z0], [x0, yBot, z1], [x0, yTop, z1], [x0, yTop, z0]], uv, 153);
      if (!opaque(px + 1, py)) quad([[x1, yBot, z1], [x1, yBot, z0], [x1, yTop, z0], [x1, yTop, z1]], uv, 153);
      if (!opaque(px, py - 1)) quad([[x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], [x0, yTop, z0]], uv, 230);
      if (!opaque(px, py + 1)) quad([[x0, yBot, z0], [x1, yBot, z0], [x1, yBot, z1], [x0, yBot, z1]], uv, 128);
    }
  }
  return { data: w.take(), quads: w.quads, translucent: false };
}

// Unit cube (or the given boxes, in block units) wearing one texture layer: the
// cracks drawn over a block while it's being mined.
export function buildOverlayMesh(boxes, layer) {
  const w = waterOut;
  w.quads = 0;
  for (const b of boxes) {
    const lo = [b[0] * 16, b[1] * 16, b[2] * 16];
    const hi = [b[3] * 16, b[4] * 16, b[5] * 16];
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      for (let c = 0; c < 4; c++) {
        const corner = face.corners[c];
        const x = corner[0] ? hi[0] : lo[0];
        const y = corner[1] ? hi[1] : lo[1];
        const z = corner[2] ? hi[2] : lo[2];
        qPos[c * 3] = Math.round(x);
        qPos[c * 3 + 1] = Math.round(y);
        qPos[c * 3 + 2] = Math.round(z);
        const [u, v] = faceUV(f, x, y, z);
        qU[c] = u;
        qV[c] = v;
        qAo[c] = 3;
        qSky[c] = 240;
        qBlk[c] = 0;
      }
      writeQuad(w, layer, 255);
    }
  }
  return { data: w.take(), quads: w.quads };
}
