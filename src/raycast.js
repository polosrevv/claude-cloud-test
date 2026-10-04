// Voxel traversal (Amanatides & Woo): walks the grid cell by cell along a ray
// and tests each cell's selection boxes, so torches, slabs and doors are hit
// where they actually are. Returns the block and the face normal it entered.
import { B, SELECTION, FLUID, FLUID_LEVEL } from './blocks.js';

const FULL = [[0, 0, 0, 1, 1, 1]];

function hitBoxes(origin, dir, x, y, z, boxes, maxDist) {
  let best = null;
  for (const b of boxes) {
    let t0 = 0;
    let t1 = maxDist;
    let axis = -1;
    let sign = 0;
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      const lo = [x, y, z][a] + b[a];
      const hi = [x, y, z][a] + b[a + 3];
      if (Math.abs(dir[a]) < 1e-12) {
        if (origin[a] < lo || origin[a] > hi) ok = false;
        continue;
      }
      let near = (lo - origin[a]) / dir[a];
      let far = (hi - origin[a]) / dir[a];
      let s = -1;
      if (near > far) { [near, far] = [far, near]; s = 1; }
      if (near > t0) { t0 = near; axis = a; sign = s; }
      if (far < t1) t1 = far;
      if (t0 > t1) ok = false;
    }
    if (!ok) continue;
    if (!best || t0 < best.t) {
      const normal = [0, 0, 0];
      if (axis >= 0) normal[axis] = sign;
      best = { t: t0, normal, box: b };
    }
  }
  return best;
}

// options.fluids: also stop at still fluid sources (for buckets).
export function raycast(world, origin, dir, maxDist, options = {}) {
  let x = Math.floor(origin[0]);
  let y = Math.floor(origin[1]);
  let z = Math.floor(origin[2]);
  const stepX = dir[0] > 0 ? 1 : -1;
  const stepY = dir[1] > 0 ? 1 : -1;
  const stepZ = dir[2] > 0 ? 1 : -1;
  const tDeltaX = dir[0] !== 0 ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = dir[1] !== 0 ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = dir[2] !== 0 ? Math.abs(1 / dir[2]) : Infinity;
  let tMaxX = dir[0] > 0 ? (x + 1 - origin[0]) * tDeltaX : dir[0] < 0 ? (origin[0] - x) * tDeltaX : Infinity;
  let tMaxY = dir[1] > 0 ? (y + 1 - origin[1]) * tDeltaY : dir[1] < 0 ? (origin[1] - y) * tDeltaY : Infinity;
  let tMaxZ = dir[2] > 0 ? (z + 1 - origin[2]) * tDeltaZ : dir[2] < 0 ? (origin[2] - z) * tDeltaZ : Infinity;
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR) {
      let boxes = SELECTION[id];
      if (options.fluids && FLUID[id] && FLUID_LEVEL[id] === 0) boxes = FULL;
      if (boxes && boxes.length) {
        const hit = hitBoxes(origin, dir, x, y, z, boxes, maxDist);
        if (hit) {
          return { x, y, z, id, normal: hit.normal, distance: hit.t, boxes, point: [origin[0] + dir[0] * hit.t, origin[1] + dir[1] * hit.t, origin[2] + dir[2] * hit.t] };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
