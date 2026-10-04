// Box collision for anything that moves: the player, mobs, items, arrows.
// Movement is clipped one axis at a time against the collision boxes of the
// blocks around the mover (the same approach Minecraft uses), with an optional
// step-up so walkers climb slabs and stairs-height ledges without jumping.
import { B, COLLISION, SELECTION, CONNECT, connectMask, connectShapes, connectSelection } from './blocks.js';

const EPS = 1e-7;
const boxes = [];

// Collision boxes of the block at (x, y, z) (block units); fences and panes depend on their neighbours.
export function shapesAt(world, x, y, z, id) {
  if (CONNECT[id]) return connectShapes(id, connectMask(id, (dx, dz) => world.getBlock(x + dx, y, z + dz)));
  return COLLISION[id];
}

// Selection (outline and targeting) boxes, likewise.
export function selectionAt(world, x, y, z, id) {
  if (CONNECT[id]) return connectSelection(id, connectMask(id, (dx, dz) => world.getBlock(x + dx, y, z + dz)));
  return SELECTION[id];
}

function gather(world, minX, minY, minZ, maxX, maxY, maxZ) {
  boxes.length = 0;
  for (let y = Math.floor(minY) - 1; y <= Math.floor(maxY); y++) {
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
        const shapes = shapesAt(world, x, y, z, world.getBlock(x, y, z, B.BEDROCK));
        if (!shapes) continue;
        for (const s of shapes) boxes.push(x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]);
      }
    }
  }
}

// a: [minX, minY, minZ, maxX, maxY, maxZ]; axis 0/1/2; returns the allowed move.
function clip(a, axis, d) {
  const o1 = (axis + 1) % 3;
  const o2 = (axis + 2) % 3;
  for (let i = 0; i < boxes.length; i += 6) {
    if (a[o1 + 3] <= boxes[i + o1] + EPS || a[o1] >= boxes[i + o1 + 3] - EPS) continue;
    if (a[o2 + 3] <= boxes[i + o2] + EPS || a[o2] >= boxes[i + o2 + 3] - EPS) continue;
    if (d > 0 && a[axis + 3] <= boxes[i + axis] + EPS) {
      const gap = boxes[i + axis] - a[axis + 3];
      if (gap < d) d = gap;
    } else if (d < 0 && a[axis] >= boxes[i + axis + 3] - EPS) {
      const gap = boxes[i + axis + 3] - a[axis];
      if (gap > d) d = gap;
    }
  }
  return d;
}

function shift(a, axis, d) {
  a[axis] += d;
  a[axis + 3] += d;
}

// body: { pos (feet centre), vel, hw (half width), h, stepHeight }. Moves the
// body by (dx, dy, dz), sets onGround / collidedH / collidedV and zeroes
// velocity on blocked axes.
export function moveBody(world, body, dx, dy, dz) {
  const p = body.pos;
  const hw = body.hw;
  const start = [p[0] - hw, p[1], p[2] - hw, p[0] + hw, p[1] + body.h, p[2] + hw];
  const step = body.stepHeight || 0;
  gather(
    world,
    Math.min(start[0], start[0] + dx), Math.min(start[1], start[1] + dy), Math.min(start[2], start[2] + dz),
    Math.max(start[3], start[3] + dx), Math.max(start[4], start[4] + dy) + step, Math.max(start[5], start[5] + dz),
  );
  const a = [...start];
  const ry = clip(a, 1, dy); shift(a, 1, ry);
  const rx = clip(a, 0, dx); shift(a, 0, rx);
  const rz = clip(a, 2, dz); shift(a, 2, rz);
  let fx = rx;
  let fy = ry;
  let fz = rz;
  let result = a;
  const blockedH = rx !== dx || rz !== dz;
  const landing = dy < 0 && ry !== dy;
  if (step > 0 && blockedH && (body.onGround || landing)) {
    const b = [...start];
    const up = clip(b, 1, step); shift(b, 1, up);
    const sx = clip(b, 0, dx); shift(b, 0, sx);
    const sz = clip(b, 2, dz); shift(b, 2, sz);
    const down = clip(b, 1, -up + Math.min(0, dy)); shift(b, 1, down);
    if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-9) {
      result = b;
      fx = sx;
      fz = sz;
      fy = up + down;
    }
  }
  p[0] = (result[0] + result[3]) / 2;
  p[1] = result[1];
  p[2] = (result[2] + result[5]) / 2;
  body.collidedH = fx !== dx || fz !== dz;
  body.collidedV = fy !== dy && !(fy > dy && dy >= 0);
  body.onGround = dy < 0 && fy > dy;
  if (fx !== dx) body.vel[0] = 0;
  if (fz !== dz) body.vel[2] = 0;
  if (ry !== dy && fy === ry) body.vel[1] = 0;
  return body;
}

// Calls fn(id, x, y, z) for every block the box overlaps.
export function forBlocksIn(world, minX, minY, minZ, maxX, maxY, maxZ, fn) {
  for (let y = Math.floor(minY); y <= Math.floor(maxY - EPS); y++) {
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ - EPS); z++) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX - EPS); x++) {
        if (fn(world.getBlock(x, y, z), x, y, z) === true) return true;
      }
    }
  }
  return false;
}

export function bodyBox(body, grow = 0) {
  const p = body.pos;
  return [p[0] - body.hw - grow, p[1] - grow, p[2] - body.hw - grow, p[0] + body.hw + grow, p[1] + body.h + grow, p[2] + body.hw + grow];
}

// Would a box at this spot overlap any collision box?
export function boxIsFree(world, minX, minY, minZ, maxX, maxY, maxZ) {
  gather(world, minX, minY, minZ, maxX, maxY, maxZ);
  for (let i = 0; i < boxes.length; i += 6) {
    if (maxX > boxes[i] + EPS && minX < boxes[i + 3] - EPS && maxY > boxes[i + 1] + EPS && minY < boxes[i + 4] - EPS &&
        maxZ > boxes[i + 2] + EPS && minZ < boxes[i + 5] - EPS) return false;
  }
  return true;
}

export function boxesOverlap(a, b) {
  return a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];
}
