// Voxel traversal (Amanatides & Woo): walks the grid cell by cell along a ray
// and returns the first block that can be targeted, plus the face it entered.
import { B } from './blocks.js';

export function raycast(world, origin, dir, maxDist) {
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
  let normal = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER) return { x, y, z, id, normal, distance: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}
