// Nether portals (any obsidian frame from 4x5 to 23x23, lit with flint and
// steel) and the stronghold's end portal (twelve frames filled with eyes).
import { B } from './blocks.js';
import { CHUNK, HEIGHT } from './constants.js';

const airish = (id) => id === B.AIR || id === B.FIRE;

// Light a portal whose interior contains (x, y, z). Returns true on success.
export function tryLightPortal(world, x, y, z) {
  for (const axis of ['x', 'z']) {
    const [dx, dz] = axis === 'x' ? [1, 0] : [0, 1];
    const get = (a, b) => world.getBlock(x + dx * a, b, z + dz * a, B.BEDROCK);
    if (!airish(get(0, y))) return false;
    let bottom = y;
    while (bottom > y - 21 && airish(get(0, bottom - 1))) bottom--;
    if (get(0, bottom - 1) !== B.OBSIDIAN) continue;
    let left = 0;
    while (left < 21 && airish(get(-(left + 1), bottom))) left++;
    let right = 0;
    while (right < 21 && airish(get(right + 1, bottom))) right++;
    const width = left + right + 1;
    if (width < 2 || width > 21 || get(-(left + 1), bottom) !== B.OBSIDIAN || get(right + 1, bottom) !== B.OBSIDIAN) continue;
    let height = 0;
    while (height < 22 && airish(get(-left, bottom + height))) height++;
    if (height < 3 || height > 21) continue;
    let ok = true;
    for (let a = -left; a <= right && ok; a++) {
      if (get(a, bottom - 1) !== B.OBSIDIAN || get(a, bottom + height) !== B.OBSIDIAN) ok = false;
      for (let h = 0; h < height && ok; h++) if (!airish(get(a, bottom + h))) ok = false;
    }
    for (let h = 0; h < height && ok; h++) {
      if (get(-left - 1, bottom + h) !== B.OBSIDIAN || get(right + 1, bottom + h) !== B.OBSIDIAN) ok = false;
    }
    if (!ok) continue;
    const id = axis === 'x' ? B.NETHER_PORTAL_X : B.NETHER_PORTAL_Z;
    for (let a = -left; a <= right; a++) {
      for (let h = 0; h < height; h++) world.setBlock(x + dx * a, bottom + h, z + dz * a, id);
    }
    return true;
  }
  return false;
}

function ensureArea(world, x, z, radius) {
  for (let cz = Math.floor((z - radius) / CHUNK); cz <= Math.floor((z + radius) / CHUNK); cz++) {
    for (let cx = Math.floor((x - radius) / CHUNK); cx <= Math.floor((x + radius) / CHUNK); cx++) world.ensureChunk(cx, cz);
  }
}

// Find a portal near (x, z) in `world`, or build one. Returns where to stand.
export function arriveThroughPortal(world, x, y, z) {
  const R = 16;
  ensureArea(world, x, z, R + 4);
  let best = null;
  for (let bz = z - R; bz <= z + R; bz++) {
    for (let bx = x - R; bx <= x + R; bx++) {
      for (let by = 1; by < HEIGHT - 1; by++) {
        const id = world.getBlock(bx, by, bz);
        if (id !== B.NETHER_PORTAL_X && id !== B.NETHER_PORTAL_Z) continue;
        if (world.getBlock(bx, by - 1, bz) === id) continue;
        const d = Math.hypot(bx - x, by - y, bz - z);
        if (!best || d < best.d) best = { x: bx, y: by, z: bz, d, id };
      }
    }
  }
  if (best) return { pos: [best.x + 0.5, best.y, best.z + 0.5], yaw: best.id === B.NETHER_PORTAL_X ? 0 : Math.PI / 2 };
  return buildPortal(world, x, y, z);
}

function buildPortal(world, x, y, z) {
  const nether = world.dimension === 'nether';
  // Prefer an open spot with a floor; otherwise carve a pocket at a safe height.
  let spot = null;
  for (let r = 0; r <= 10 && !spot; r += 2) {
    for (let bz = z - r; bz <= z + r && !spot; bz += 2) {
      for (let bx = x - r; bx <= x + r && !spot; bx += 2) {
        const top = nether ? 100 : HEIGHT - 6;
        for (let by = top; by > (nether ? 34 : 4); by--) {
          if (fits(world, bx, by, bz)) { spot = [bx, by, bz]; break; }
        }
      }
    }
  }
  if (!spot) spot = [x, nether ? 70 : Math.max(64, Math.min(y, HEIGHT - 10)), z];
  const [bx, by, bz] = spot;
  // Platform and clearance.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 2; dx++) {
      world.setBlock(bx + dx, by - 1, bz + dz, B.OBSIDIAN);
      for (let h = 0; h < 4; h++) world.setBlock(bx + dx, by + h, bz + dz, B.AIR);
    }
  }
  for (let dx = -1; dx <= 2; dx++) {
    for (let h = -1; h <= 3; h++) {
      const frame = dx === -1 || dx === 2 || h === -1 || h === 3;
      world.setBlock(bx + dx, by + h, bz, frame ? B.OBSIDIAN : B.NETHER_PORTAL_X);
    }
  }
  return { pos: [bx + 1, by, bz + 0.5], yaw: 0 };
}

function fits(world, bx, by, bz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 2; dx++) {
      const floor = world.getBlock(bx + dx, by - 1, bz + dz, B.AIR);
      if (floor === B.AIR || floor === B.LAVA || floor === B.WATER) return false;
      for (let h = 0; h < 4; h++) if (world.getBlock(bx + dx, by + h, bz + dz, B.STONE) !== B.AIR) return false;
    }
  }
  return true;
}

// After an eye goes into a frame: if all twelve frames around a 3x3 hole are
// filled, the portal opens. Returns true when it does.
export function checkEndPortal(world, x, y, z) {
  const centres = [];
  for (let k = -1; k <= 1; k++) {
    centres.push([x - k, z + 2], [x - k, z - 2], [x + 2, z - k], [x - 2, z - k]);
  }
  for (const [cx, cz] of centres) {
    let ok = true;
    for (let k = -1; k <= 1 && ok; k++) {
      for (const [fx, fz] of [[cx + k, cz - 2], [cx + k, cz + 2], [cx - 2, cz + k], [cx + 2, cz + k]]) {
        if (world.getBlock(fx, y, fz) !== B.END_PORTAL_FRAME_EYE) { ok = false; break; }
      }
    }
    if (!ok) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.setBlock(cx + dx, y, cz + dz, B.END_PORTAL);
    return true;
  }
  return false;
}
