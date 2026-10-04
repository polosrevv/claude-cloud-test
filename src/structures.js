// Trees and built structures. Builders write through a set(x, y, z, id, force)
// callback, so the same code places blocks during chunk generation (clipped to
// the chunk) and in the live world (saplings growing).
import { hash2, hash3 } from './noise.js';
import { B, facingBlock } from './blocks.js';

export function broadleafTree(set, x, ground, z, trunk, log, leaf, seed) {
  const top = ground + trunk;
  for (let y = ground + 1; y <= top; y++) set(x, y, z, log, true);
  for (let y = top - 2; y <= top + 1; y++) {
    const r = y >= top ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (y === top + 1 || hash3(x + dx, y, z + dz, seed) < 0.5)) continue;
        set(x + dx, y, z + dz, leaf, false);
      }
    }
  }
}

export function spruceTree(set, x, ground, z, trunk) {
  const top = ground + trunk;
  for (let y = ground + 1; y <= top; y++) set(x, y, z, B.SPRUCE_LOG, true);
  const radii = [0, 1, 1, 2, 1, 2, 3, 2, 3];
  for (let i = 0; i < radii.length; i++) {
    const y = top + 1 - i;
    if (y <= ground + 2) break;
    const r = radii[i];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz <= r * r + 0.5) set(x + dx, y, z + dz, B.SPRUCE_LEAVES, false);
      }
    }
  }
}

export const STRONGHOLD_SIZE = [11, 8, 16];

// Portal room: stone brick walls, a 3x3 lava pit ringed by twelve frames.
// (ox, oy, oz) is the room's minimum corner.
export function strongholdRoom(set, ox, oy, oz, seed) {
  const [sx, sy, sz] = STRONGHOLD_SIZE;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const wall = x === 0 || y === 0 || z === 0 || x === sx - 1 || y === sy - 1 || z === sz - 1;
        let id = B.AIR;
        if (wall) {
          const h = hash3(ox + x, oy + y, oz + z, seed);
          id = h < 0.7 ? B.STONE_BRICKS : h < 0.85 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE;
        }
        set(ox + x, oy + y, oz + z, id, true);
      }
    }
  }
  // Lava pit under the portal.
  for (let z = 9; z <= 11; z++) {
    for (let x = 4; x <= 6; x++) {
      set(ox + x, oy, oz + z, B.LAVA, true);
      set(ox + x, oy - 1, oz + z, B.STONE_BRICKS, true);
    }
  }
  const frames = [];
  for (let i = 0; i < 3; i++) {
    frames.push([4 + i, 8], [4 + i, 12], [3, 9 + i], [7, 9 + i]);
  }
  for (const [x, z] of frames) {
    const filled = hash2(ox + x, oz + z, seed ^ 0x5eed) < 0.1;
    set(ox + x, oy + 1, oz + z, filled ? B.END_PORTAL_FRAME_EYE : B.END_PORTAL_FRAME, true);
  }
  set(ox + 1, oy + 1, oz + 1, B.CHEST_S, true);
  set(ox + 1, oy + 4, oz + 5, facingBlock('wall_torch', 1), true);
  set(ox + sx - 2, oy + 4, oz + 5, facingBlock('wall_torch', 3), true);
}

export const DUNGEON_SIZE = [9, 6, 9];

export function dungeon(set, get, ox, oy, oz, seed) {
  const [sx, sy, sz] = DUNGEON_SIZE;
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const wall = x === 0 || y === 0 || z === 0 || x === sx - 1 || y === sy - 1 || z === sz - 1;
        if (wall) {
          // Walls only replace solid ground, so caves that cut through stay open.
          const cur = get(ox + x, oy + y, oz + z);
          if (cur === null || cur === B.AIR) continue;
          set(ox + x, oy + y, oz + z, y === 0 && hash3(ox + x, oy, oz + z, seed) < 0.6 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE, true);
        } else {
          set(ox + x, oy + y, oz + z, B.AIR, true);
        }
      }
    }
  }
  set(ox + 4, oy + 1, oz + 4, B.SPAWNER, true);
  set(ox + 1, oy + 1, oz + 4, B.CHEST_E, true);
  if (hash2(ox, oz, seed) < 0.5) set(ox + 7, oy + 1, oz + 4, B.CHEST_W, true);
}

// Nether fortress: two crossing bridges, a hall with a blaze spawner, and a
// spawner platform at the end of the east bridge.
export const FORTRESS_Y = 64;
export const FORTRESS_REACH = 60;

export function fortress(set, columnBottom, fx, fz) {
  const Y = FORTRESS_Y;
  const R = FORTRESS_REACH;
  const bridge = (along) => {
    for (let t = -R; t <= R; t++) {
      for (let o = -2; o <= 2; o++) {
        const x = along === 'x' ? fx + t : fx + o;
        const z = along === 'x' ? fz + o : fz + t;
        set(x, Y, z, B.NETHER_BRICKS, true);
        if (Math.abs(o) === 2) set(x, Y + 1, z, B.NETHER_BRICKS, true);
        else for (let y = Y + 1; y <= Y + 4; y++) set(x, y, z, B.AIR, true);
        // Support pillars every eight blocks reach down to the ground.
        if (t % 8 === 0 && Math.abs(o) <= 1) {
          const bottom = columnBottom(x, z, Y - 1);
          for (let y = Y - 1; y > bottom; y--) set(x, y, z, B.NETHER_BRICKS, true);
        }
      }
    }
  };
  bridge('x');
  bridge('z');
  // Central hall.
  for (let y = Y; y <= Y + 7; y++) {
    for (let dz = -7; dz <= 7; dz++) {
      for (let dx = -7; dx <= 7; dx++) {
        const wall = Math.abs(dx) === 7 || Math.abs(dz) === 7;
        const door = (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) && y > Y && y <= Y + 3;
        let id = B.AIR;
        if (y === Y || y === Y + 7) id = B.NETHER_BRICKS;
        else if (wall && !door) id = B.NETHER_BRICKS;
        set(fx + dx, y, fz + dz, id, true);
      }
    }
  }
  set(fx, Y + 1, fz, B.SPAWNER, true);
  set(fx + 5, Y + 1, fz + 5, B.CHEST_N, true);
  // Spawner platform at the far end of the east bridge.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      set(fx + R + dx, Y, fz + dz, B.NETHER_BRICKS, true);
      if (Math.abs(dx) === 3 || Math.abs(dz) === 3) set(fx + R + dx, Y + 1, fz + dz, B.NETHER_BRICKS, true);
      else for (let y = Y + 1; y <= Y + 4; y++) set(fx + R + dx, y, fz + dz, B.AIR, true);
    }
  }
  set(fx + R, Y + 1, fz, B.SPAWNER, true);
}
