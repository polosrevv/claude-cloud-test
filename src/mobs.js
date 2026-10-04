// Mob definitions and behaviour. Passive animals wander, panic and breed;
// hostile mobs find a path to the player and attack in their own way.
import { B, SOLID, FLUID, BLOCKS } from './blocks.js';
import { moveBody, forBlocksIn } from './physics.js';

const DT = 0.05;

export const MOBS = {
  pig: { name: 'Pig', model: 'pig', hw: 0.45, h: 0.9, health: 10, speed: 2.2, passive: true, food: 'wheat', drops: [['porkchop', 1, 3, 'cooked_porkchop']], sound: 'pig' },
  cow: { name: 'Cow', model: 'cow', hw: 0.45, h: 1.4, health: 10, speed: 2.0, passive: true, food: 'wheat', drops: [['beef', 1, 3, 'steak'], ['leather', 0, 2]], sound: 'cow' },
  sheep: { name: 'Sheep', model: 'sheep', hw: 0.45, h: 1.3, health: 8, speed: 2.0, passive: true, food: 'wheat', drops: [['mutton', 1, 2, 'cooked_mutton']], sound: 'sheep' },
  chicken: { name: 'Chicken', model: 'chicken', hw: 0.2, h: 0.7, health: 4, speed: 2.0, passive: true, food: 'wheat_seeds', drops: [['chicken', 1, 1, 'cooked_chicken'], ['feather', 0, 2]], sound: 'chicken', slowFall: true },
  zombie: { name: 'Zombie', model: 'zombie', hw: 0.3, h: 1.95, health: 20, speed: 2.3, hostile: true, damage: [2, 3, 4], burns: true, drops: [['rotten_flesh', 0, 2]], sound: 'zombie' },
  skeleton: { name: 'Skeleton', model: 'skeleton', hw: 0.3, h: 1.99, health: 20, speed: 2.5, hostile: true, ranged: true, burns: true, drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton' },
  creeper: { name: 'Creeper', model: 'creeper', hw: 0.3, h: 1.7, health: 20, speed: 2.4, hostile: true, explodes: true, drops: [['gunpowder', 0, 2]], sound: 'creeper' },
  spider: { name: 'Spider', model: 'spider', hw: 0.7, h: 0.9, health: 16, speed: 3.0, hostile: true, damage: [2, 2, 3], climbs: true, drops: [['string', 0, 2]], sound: 'spider' },
  enderman: { name: 'Enderman', model: 'enderman', hw: 0.3, h: 2.9, health: 40, speed: 3.0, hostile: true, neutral: true, damage: [4, 7, 10], drops: [['ender_pearl', 0, 1, null, 0.7]], sound: 'enderman' },
  blaze: { name: 'Blaze', model: 'blaze', hw: 0.3, h: 1.8, health: 20, speed: 2.4, hostile: true, flying: true, fireImmune: true, drops: [['blaze_rod', 0, 1, null, 0.8]], sound: 'blaze' },
  dragon: { name: 'Ender Dragon', model: 'dragon', hw: 4, h: 4, health: 200, speed: 12, hostile: true, boss: true, fireImmune: true, drops: [], sound: 'dragon' },
};

export function createMob(type, x, y, z) {
  const def = MOBS[type];
  return {
    id: Math.floor(Math.random() * 1e9),
    kind: 'mob',
    type,
    def,
    pos: [x, y, z],
    prev: [x, y, z],
    vel: [0, 0, 0],
    yaw: Math.random() * Math.PI * 2,
    prevYaw: 0,
    bodyYaw: 0,
    prevBodyYaw: 0,
    headYaw: 0,
    headPitch: 0,
    hw: def.hw,
    h: def.h,
    stepHeight: 0.6,
    onGround: false,
    collidedH: false,
    age: 0,
    removed: false,
    health: def.health,
    hurtTime: 0,
    invuln: 0,
    lastDamage: 0,
    deathTime: 0,
    fire: 0,
    fallDistance: 0,
    attackCooldown: 0,
    attackAnim: 0,
    limbSwing: 0,
    limbAmount: 0,
    panic: 0,
    path: null,
    pathIndex: 0,
    repath: 0,
    wander: null,
    box(grow = 0) {
      const p = this.pos;
      const s = this.growUp < 0 ? 0.5 : 1;
      return [p[0] - this.hw * s - grow, p[1] - grow, p[2] - this.hw * s - grow, p[0] + this.hw * s + grow, p[1] + this.h * s + grow, p[2] + this.hw * s + grow];
    },
    centre() {
      return [this.pos[0], this.pos[1] + this.h / 2, this.pos[2]];
    },
  };
}

const difficultyIndex = (d) => ({ easy: 0, normal: 1, hard: 2 })[d] ?? 1;

// ---- Pathfinding ----
// A* over walkable cells: two (or more) clear blocks with something solid underneath.

function passable(world, x, y, z) {
  const id = world.getBlock(x, y, z, B.BEDROCK);
  return !SOLID[id] && FLUID[id] !== 2 && id !== B.FIRE && id !== B.CACTUS;
}

function standable(world, x, y, z, height) {
  for (let k = 0; k < height; k++) if (!passable(world, x, y + k, z)) return false;
  const below = world.getBlock(x, y - 1, z, B.BEDROCK);
  return (SOLID[below] && below !== B.CACTUS) || FLUID[below] === 1 || FLUID[world.getBlock(x, y, z)] === 1;
}

class Heap {
  constructor() { this.items = []; }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

export function findPath(world, start, goal, height, maxNodes = 500) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const h = (x, y, z) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]) * 1.5 + Math.abs(z - goal[2]);
  const open = new Heap();
  const seen = new Map();
  const first = { x: start[0], y: start[1], z: start[2], g: 0, f: h(...start), parent: null };
  open.push(first);
  seen.set(key(start[0], start[1], start[2]), 0);
  let best = first;
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const n = open.pop();
    expanded++;
    if (n.x === goal[0] && n.z === goal[2] && Math.abs(n.y - goal[1]) <= 1) { best = n; break; }
    if (h(n.x, n.y, n.z) < h(best.x, best.y, best.z)) best = n;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = n.x + dx;
      const nz = n.z + dz;
      let ny = null;
      if (standable(world, nx, n.y, nz, height)) ny = n.y;
      else if (passable(world, n.x, n.y + height, n.z) && standable(world, nx, n.y + 1, nz, height)) ny = n.y + 1;
      else if (passable(world, nx, n.y, nz) && passable(world, nx, n.y + 1, nz)) {
        for (let drop = 1; drop <= 3; drop++) {
          if (standable(world, nx, n.y - drop, nz, height)) { ny = n.y - drop; break; }
          if (!passable(world, nx, n.y - drop, nz)) break;
        }
      }
      if (ny === null) continue;
      const g = n.g + 1 + (ny !== n.y ? 0.5 : 0);
      const k = key(nx, ny, nz);
      if (seen.has(k) && seen.get(k) <= g) continue;
      seen.set(k, g);
      open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n });
    }
  }
  const path = [];
  for (let n = best; n; n = n.parent) path.unshift([n.x, n.y, n.z]);
  return path.length > 1 ? path : null;
}

// ---- Sight ----
export function canSee(world, from, to, max = 48) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len > max) return false;
  const steps = Math.ceil(len / 0.4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const id = world.getBlock(Math.floor(from[0] + d[0] * t), Math.floor(from[1] + d[1] * t), Math.floor(from[2] + d[2] * t));
    if (SOLID[id] && BLOCKS[id].opaque !== false) return false;
  }
  return true;
}

// ---- Damage ----
// source: { kind: 'player' | 'arrow' | 'explosion' | 'fire' | 'lava' | 'fall' | 'cactus' | 'mob', dir?, entity? }
export function hurtMob(e, amount, game, source = {}) {
  if (e.removed || e.deathTime > 0) return false;
  const def = e.def;
  if (def.fireImmune && (source.kind === 'fire' || source.kind === 'lava')) return false;
  if (e.type === 'enderman' && source.kind === 'arrow') {
    teleportRandomly(e, game);
    return false;
  }
  // Like Minecraft: during the half second after a hit, only a harder hit
  // gets through, and only for the difference.
  if (e.invuln > 0) {
    if (amount <= e.lastDamage) return false;
    const full = amount;
    amount -= e.lastDamage;
    e.lastDamage = full;
  } else {
    e.invuln = 10;
    e.lastDamage = amount;
  }
  e.health -= amount;
  e.hurtTime = 10;
  if (source.dir && e.type !== 'dragon') {
    const k = source.knockback ?? 1;
    const len = Math.hypot(source.dir[0], source.dir[2]) || 1;
    e.vel[0] = (source.dir[0] / len) * 4 * k;
    e.vel[2] = (source.dir[2] / len) * 4 * k;
    if (e.onGround) e.vel[1] = 4.5;
  }
  if (def.passive) {
    e.panic = 100;
    e.panicFrom = source.entity === 'player' ? game.player.pos : null;
  }
  if (source.entity === 'player' || source.kind === 'player') {
    e.provoked = true;
    if (e.type === 'enderman') e.angry = true;
    e.lastHitByPlayer = game.tickCount;
  }
  if (e.type === 'enderman' && Math.random() < 0.3) teleportRandomly(e, game);
  game.sound(`${def.sound}_hurt`, e.pos);
  if (e.health <= 0) {
    e.health = 0;
    e.deathTime = 1;
    game.sound(`${def.sound}_death`, e.pos);
    if (e.type !== 'dragon') dropLoot(e, game);
    game.onMobKilled?.(e, source);
  }
  return true;
}

function dropLoot(e, game) {
  if (e.growUp < 0) return;
  const byPlayer = e.lastHitByPlayer !== undefined && game.tickCount - e.lastHitByPlayer < 100;
  const stacks = [];
  for (const [item, min, max, cooked, chance = 1] of e.def.drops) {
    if (Math.random() > chance) continue;
    const n = min + Math.floor(Math.random() * (max - min + 1));
    if (n > 0) stacks.push({ item: e.fire > 0 && cooked ? cooked : item, count: n });
  }
  if (e.type === 'sheep' && !e.sheared) stacks.push({ item: 'wool_white', count: 1 });
  if (e.type === 'creeper' && !byPlayer) stacks.length = 0;
  game.dropStacks([e.pos[0], e.pos[1] + 0.5, e.pos[2]], stacks);
}

export function teleportRandomly(e, game, toward = null) {
  const world = game.world;
  for (let attempt = 0; attempt < 16; attempt++) {
    const cx = toward ? toward[0] + (Math.random() - 0.5) * 12 : e.pos[0] + (Math.random() - 0.5) * 32;
    const cz = toward ? toward[2] + (Math.random() - 0.5) * 12 : e.pos[2] + (Math.random() - 0.5) * 32;
    const x = Math.floor(cx);
    const z = Math.floor(cz);
    if (!world.isLoaded(x, z)) continue;
    for (let y = Math.floor(e.pos[1]) + 16; y > Math.floor(e.pos[1]) - 16; y--) {
      if (y < 1) break;
      if (standable(world, x, y, z, 3) && !FLUID[world.getBlock(x, y - 1, z)]) {
        game.particles.burst([e.pos[0], e.pos[1] + 1.5, e.pos[2]], 'portal', 16, 0.6);
        e.pos = [x + 0.5, y, z + 0.5];
        e.prev = [...e.pos];
        e.path = null;
        game.sound('teleport', e.pos);
        return true;
      }
    }
  }
  return false;
}

// ---- Tick ----
export function tickMob(e, game) {
  const def = e.def;
  if (e.type === 'dragon') {
    game.dragonFight?.tickDragon(e);
    return;
  }
  if (e.deathTime > 0) {
    e.deathTime++;
    e.vel[0] *= 0.6;
    e.vel[2] *= 0.6;
    gravity(e);
    moveBody(game.world, e, e.vel[0] * DT, e.vel[1] * DT, e.vel[2] * DT);
    if (e.deathTime > 20) {
      e.removed = true;
      game.particles.burst([e.pos[0], e.pos[1] + e.h / 2, e.pos[2]], 'smoke', 10, 0.5);
    }
    return;
  }
  if (e.hurtTime > 0) e.hurtTime--;
  if (e.invuln > 0) e.invuln--;
  if (e.invuln === 0) e.lastDamage = 0;
  if (e.attackCooldown > 0) e.attackCooldown--;
  if (e.attackAnim > 0) e.attackAnim = Math.max(0, e.attackAnim - 0.15);
  if (e.growUp < 0) e.growUp++;
  if (e.breedCooldown > 0) e.breedCooldown--;
  if (e.inLove > 0) {
    e.inLove--;
    if (e.age % 10 === 0) game.particles.burst([e.pos[0], e.pos[1] + e.h, e.pos[2]], 'heart', 1, 0.3);
  }

  environment(e, game);
  if (e.removed || e.deathTime > 0) return;

  const p = game.player;
  const wish = { x: 0, z: 0, speed: def.speed, jump: false };
  const target = chooseTarget(e, game);
  e.target = target;
  if (def.passive) passiveAI(e, game, wish);
  else if (e.type === 'skeleton') skeletonAI(e, game, wish, target);
  else if (e.type === 'creeper') creeperAI(e, game, wish, target);
  else if (e.type === 'blaze') blazeAI(e, game, wish, target);
  else meleeAI(e, game, wish, target);

  // Look at the player when nearby and idle.
  const lookAt = target ? [p.pos[0], p.pos[1] + 1.6, p.pos[2]] : null;
  if (lookAt) {
    const dx = lookAt[0] - e.pos[0];
    const dz = lookAt[2] - e.pos[2];
    const dy = lookAt[1] - (e.pos[1] + e.h * 0.85);
    e.headYaw = wrap(Math.atan2(-dx, -dz) - e.bodyYaw);
    e.headYaw = Math.max(-1.2, Math.min(1.2, e.headYaw));
    e.headPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
  } else {
    e.headYaw *= 0.9;
    e.headPitch *= 0.9;
  }

  move(e, game, wish);
  pushApart(e, game);
  if (def.hostile && !e.persistent) despawnCheck(e, game);
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function environment(e, game) {
  const world = game.world;
  const def = e.def;
  const b = e.box();
  let inWater = false;
  let inLava = false;
  let cactus = false;
  let fire = false;
  forBlocksIn(world, b[0], b[1], b[2], b[3], b[4], b[5], (id) => {
    if (FLUID[id] === 1) inWater = true;
    if (FLUID[id] === 2) inLava = true;
    if (id === B.FIRE) fire = true;
    return false;
  });
  forBlocksIn(world, b[0] - 0.05, b[1], b[2] - 0.05, b[3] + 0.05, b[4], b[5] + 0.05, (id) => {
    if (id === B.CACTUS) cactus = true;
    return false;
  });
  e.inWater = inWater;
  e.inLava = inLava;
  const inRain = !!game.weather?.wet(world, e.pos[0], e.pos[1] + e.h, e.pos[2]);
  if (inWater || inRain) e.fire = 0;
  if (!def.fireImmune) {
    if (inLava) {
      e.fire = Math.max(e.fire, 300);
      if (e.age % 10 === 0) hurtMob(e, 4, game, { kind: 'lava' });
    }
    if (fire) e.fire = Math.max(e.fire, 160);
    if (def.burns && game.isDay() && !inWater && !inRain && !e.helmet) {
      const head = [Math.floor(e.pos[0]), Math.floor(e.pos[1] + e.h), Math.floor(e.pos[2])];
      if (world.skyLightAt(head[0], head[1], head[2]) >= 15 && game.sunlight() > 0.8 && Math.random() < 0.3) e.fire = Math.max(e.fire, 160);
    }
    if (e.fire > 0) {
      e.fire--;
      if (e.fire % 20 === 0) hurtMob(e, 1, game, { kind: 'fire' });
      if (e.age % 3 === 0) game.particles.burst([e.pos[0], e.pos[1] + Math.random() * e.h, e.pos[2]], 'flame', 1, e.hw);
    }
  } else {
    e.fire = 0;
  }
  if (cactus && e.age % 10 === 0) hurtMob(e, 1, game, { kind: 'cactus' });
  if (e.type === 'enderman' && (inWater || inRain) && e.age % 10 === 0) {
    hurtMob(e, 1, game, { kind: 'water' });
    teleportRandomly(e, game);
  }
}

function chooseTarget(e, game) {
  const def = e.def;
  const p = game.player;
  if (def.passive || p.dead || !p.vulnerable || game.difficulty === 'peaceful') {
    e.angry = false;
    return null;
  }
  const dx = p.pos[0] - e.pos[0];
  const dy = p.pos[1] - e.pos[1];
  const dz = p.pos[2] - e.pos[2];
  const dist = Math.hypot(dx, dy, dz);
  if (e.type === 'enderman') {
    if (!e.angry) {
      // Looking an enderman in the eye makes it angry.
      const look = p.look;
      const eye = p.eye;
      const head = [e.pos[0], e.pos[1] + 2.6, e.pos[2]];
      const to = [head[0] - eye[0], head[1] - eye[1], head[2] - eye[2]];
      const len = Math.hypot(to[0], to[1], to[2]);
      const dot = (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (len || 1);
      if (len < 64 && dot > 1 - 0.025 / Math.max(1, len * 0.15) && canSee(game.world, eye, head, 64)) {
        e.angry = true;
        game.sound('enderman_stare', e.pos);
      }
    }
    if (!e.angry) return null;
    if (dist > 64) { e.angry = false; return null; }
    return p;
  }
  if (e.type === 'spider' && !e.provoked && game.lightAt(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.5), Math.floor(e.pos[2])) > 11) {
    return null;
  }
  const range = e.type === 'zombie' ? 35 : e.type === 'blaze' ? 48 : 16;
  if (dist > range) return null;
  const eye = [e.pos[0], e.pos[1] + e.h * 0.85, e.pos[2]];
  if (canSee(game.world, eye, p.eye, range)) e.lastSeen = game.tickCount;
  if (e.lastSeen !== undefined && game.tickCount - e.lastSeen < 100) return p;
  return null;
}

function steerTo(e, wish, x, z, speedMul = 1) {
  const dx = x - e.pos[0];
  const dz = z - e.pos[2];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return len;
  wish.x = dx / len;
  wish.z = dz / len;
  wish.speed *= speedMul;
  return len;
}

// Follow (or plan) a path to a goal; falls back to walking straight at it.
function walkTo(e, game, wish, goal, speedMul = 1) {
  const gx = Math.floor(goal[0]);
  const gy = Math.floor(goal[1]);
  const gz = Math.floor(goal[2]);
  if (e.repath > 0) e.repath--;
  const moved = e.pathGoal && (Math.abs(e.pathGoal[0] - gx) + Math.abs(e.pathGoal[2] - gz) > 2);
  if (!e.path || e.repath <= 0 || moved) {
    const height = Math.ceil(e.h);
    e.path = findPath(game.world, [Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.1), Math.floor(e.pos[2])], [gx, gy, gz], height, 400);
    e.pathIndex = 1;
    e.pathGoal = [gx, gy, gz];
    e.repath = 20 + Math.floor(Math.random() * 20);
  }
  if (e.path && e.pathIndex < e.path.length) {
    const node = e.path[e.pathIndex];
    const d = steerTo(e, wish, node[0] + 0.5, node[2] + 0.5, speedMul);
    if (node[1] > Math.floor(e.pos[1] + 0.1)) wish.jump = true;
    if (d < 0.35 && Math.abs(node[1] - e.pos[1]) < 1.2) e.pathIndex++;
  } else {
    steerTo(e, wish, goal[0], goal[2], speedMul);
  }
  if (e.collidedH) wish.jump = true;
}

function passiveAI(e, game, wish) {
  const def = e.def;
  const p = game.player;
  wish.speed = def.speed * 0.5;
  if (e.panic > 0) {
    e.panic--;
    if (!e.fleeTo || e.panic % 30 === 0) {
      const from = e.panicFrom ?? [e.pos[0] + Math.random() - 0.5, 0, e.pos[2] + Math.random() - 0.5];
      const dx = e.pos[0] - from[0];
      const dz = e.pos[2] - from[2];
      const len = Math.hypot(dx, dz) || 1;
      e.fleeTo = [e.pos[0] + (dx / len) * 8 + (Math.random() - 0.5) * 6, e.pos[1], e.pos[2] + (dz / len) * 8 + (Math.random() - 0.5) * 6];
    }
    wish.speed = def.speed * 1.25;
    steerTo(e, wish, e.fleeTo[0], e.fleeTo[2]);
    if (e.collidedH) wish.jump = true;
    return;
  }
  // Follow a player holding their favourite food.
  const held = game.heldItem?.();
  const distToPlayer = Math.hypot(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]);
  if (held === def.food && distToPlayer < 10 && !p.dead) {
    if (distToPlayer > 2) walkTo(e, game, wish, p.pos, 1.2);
    return;
  }
  // Find a partner when in love.
  if (e.inLove > 0) {
    const mate = game.entities.mobs((o) => o !== e && o.type === e.type && o.inLove > 0 && Math.hypot(o.pos[0] - e.pos[0], o.pos[2] - e.pos[2]) < 8)[0];
    if (mate) {
      const d = steerTo(e, wish, mate.pos[0], mate.pos[2]);
      if (d < 1.4 && e.id < mate.id) {
        e.inLove = mate.inLove = 0;
        e.breedCooldown = mate.breedCooldown = 6000;
        const baby = createMob(e.type, e.pos[0], e.pos[1], e.pos[2]);
        baby.growUp = -6000;
        game.entities.add(baby);
        game.particles.burst([e.pos[0], e.pos[1] + 1, e.pos[2]], 'heart', 6, 0.6);
      }
      return;
    }
  }
  // Sheep regrow their wool by grazing.
  if (e.type === 'sheep' && e.sheared && Math.random() < 0.002) {
    const below = [Math.floor(e.pos[0]), Math.floor(e.pos[1] - 0.5), Math.floor(e.pos[2])];
    if (game.world.getBlock(...below) === B.GRASS) {
      game.world.setBlock(...below, B.DIRT);
      e.sheared = false;
      e.eating = 20;
    }
  }
  if (e.eating > 0) { e.eating--; return; }
  if (!e.wander || Math.random() < 0.005) {
    if (Math.random() < 0.02 || !e.wander) {
      e.wander = Math.random() < 0.5 ? null : [e.pos[0] + (Math.random() - 0.5) * 16, e.pos[1], e.pos[2] + (Math.random() - 0.5) * 16];
    }
  }
  if (e.wander) {
    const d = Math.hypot(e.wander[0] - e.pos[0], e.wander[2] - e.pos[2]);
    if (d < 1) e.wander = null;
    else {
      walkTo(e, game, wish, e.wander);
      if (e.age % 200 === 0) e.wander = null;
    }
  }
  if (Math.random() < 0.002) game.sound(`${def.sound}_say`, e.pos);
}

function meleeAI(e, game, wish, target) {
  const def = e.def;
  if (!target) return wanderHostile(e, game, wish);
  const p = target;
  const dist = Math.hypot(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]);
  const dy = p.pos[1] - e.pos[1];
  if (e.type === 'enderman') {
    wish.speed = 4.5;
    if (dist > 12 && Math.random() < 0.02) teleportRandomly(e, game, p.pos);
  }
  if (dist > 1.2) walkTo(e, game, wish, p.pos);
  if (e.type === 'spider' && e.onGround && dist < 4 && dist > 2 && Math.random() < 0.1) {
    e.vel[1] = 6;
    e.vel[0] = ((p.pos[0] - e.pos[0]) / dist) * 6;
    e.vel[2] = ((p.pos[2] - e.pos[2]) / dist) * 6;
  }
  const reach = e.hw + 0.3 + 1.2;
  if (dist < reach && dy > -1.5 && dy < e.h && e.attackCooldown === 0) {
    e.attackCooldown = 20;
    e.attackAnim = 1;
    const dmg = def.damage[difficultyIndex(game.difficulty)];
    game.damagePlayer(dmg, 'mob', e);
  }
  if (Math.random() < 0.004) game.sound(`${def.sound}_say`, e.pos);
}

function wanderHostile(e, game, wish) {
  wish.speed = e.def.speed * 0.5;
  if (!e.wander && Math.random() < 0.01) e.wander = [e.pos[0] + (Math.random() - 0.5) * 12, e.pos[1], e.pos[2] + (Math.random() - 0.5) * 12];
  if (e.wander) {
    if (Math.hypot(e.wander[0] - e.pos[0], e.wander[2] - e.pos[2]) < 1 || e.age % 160 === 0) e.wander = null;
    else walkTo(e, game, wish, e.wander);
  }
  if (Math.random() < 0.003) game.sound(`${e.def.sound}_say`, e.pos);
}

function skeletonAI(e, game, wish, target) {
  e.aiming = false;
  if (!target) return wanderHostile(e, game, wish);
  const p = target;
  const dist = Math.hypot(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]);
  const sees = e.lastSeen === game.tickCount;
  if (!sees || dist > 14) {
    walkTo(e, game, wish, p.pos);
    return;
  }
  e.aiming = true;
  // Keep a comfortable range and strafe a little.
  if (dist < 5) {
    steerTo(e, wish, e.pos[0] - (p.pos[0] - e.pos[0]), e.pos[2] - (p.pos[2] - e.pos[2]), 0.8);
  } else if (dist > 10) {
    walkTo(e, game, wish, p.pos, 0.8);
  } else {
    const side = Math.sin(e.age * 0.03) > 0 ? 1 : -1;
    wish.x = (-(p.pos[2] - e.pos[2]) / dist) * side;
    wish.z = ((p.pos[0] - e.pos[0]) / dist) * side;
    wish.speed *= 0.4;
  }
  if (e.attackCooldown === 0) {
    e.attackCooldown = game.difficulty === 'hard' ? 25 : 40;
    const from = [e.pos[0], e.pos[1] + 1.5, e.pos[2]];
    const to = [p.pos[0], p.pos[1] + 1.1, p.pos[2]];
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const flat = Math.hypot(dx, dz);
    const dir = [dx, to[1] - from[1] + flat * 0.2, dz];
    const spread = [0.25, 0.12, 0.05][difficultyIndex(game.difficulty)];
    game.shootArrow(from, dir, 32, e.id, spread, false);
  }
}

function creeperAI(e, game, wish, target) {
  e.fuse = e.fuse ?? 0;
  if (!target) {
    e.fuse = Math.max(0, e.fuse - 1);
    return wanderHostile(e, game, wish);
  }
  const p = target;
  const dist = Math.hypot(p.pos[0] - e.pos[0], p.pos[1] - e.pos[1], p.pos[2] - e.pos[2]);
  if (dist < 3 || (e.fuse > 0 && dist < 7)) {
    if (e.fuse === 0) game.sound('creeper_fuse', e.pos);
    e.fuse++;
    wish.speed = 0;
    if (e.fuse >= 30) {
      e.removed = true;
      game.explode(e.pos[0], e.pos[1] + 0.8, e.pos[2], 3, { source: e, griefing: game.gamerules.mobGriefing });
    }
  } else {
    e.fuse = Math.max(0, e.fuse - 1);
    walkTo(e, game, wish, p.pos);
  }
}

function blazeAI(e, game, wish, target) {
  e.flyY = e.flyY ?? e.pos[1];
  if (target) {
    e.flyY = target.pos[1] + 2.5 + Math.sin(e.age * 0.05);
    const dist = Math.hypot(target.pos[0] - e.pos[0], target.pos[2] - e.pos[2]);
    if (dist > 6) steerTo(e, wish, target.pos[0], target.pos[2], 0.6);
    else if (dist < 3) steerTo(e, wish, e.pos[0] - (target.pos[0] - e.pos[0]), e.pos[2] - (target.pos[2] - e.pos[2]), 0.5);
    e.volley = e.volley ?? 0;
    if (e.attackCooldown === 0 && e.lastSeen === game.tickCount && dist < 32) {
      e.volley++;
      if (e.volley <= 3) {
        e.attackCooldown = 6;
        const from = [e.pos[0], e.pos[1] + 1.4, e.pos[2]];
        const dir = [target.pos[0] - from[0] + (Math.random() - 0.5) * 2, target.pos[1] + 1 - from[1], target.pos[2] - from[2] + (Math.random() - 0.5) * 2];
        const len = Math.hypot(...dir);
        game.entities.add(game.makeProjectile('fireball', from, dir.map((v) => (v / len) * 16), e.id));
        game.sound('blaze_shoot', e.pos);
      } else {
        e.volley = 0;
        e.attackCooldown = 80;
      }
    }
  } else {
    const ground = game.world.surfaceY(Math.floor(e.pos[0]), Math.floor(e.pos[2]));
    if (Math.random() < 0.01) e.flyY = Math.max(ground + 2, e.pos[1] + (Math.random() - 0.5) * 4);
  }
  if (Math.random() < 0.004) game.sound('blaze_say', e.pos);
}

function gravity(e) {
  if (e.def.flying) return;
  if (e.inWater || e.inLava) {
    e.vel[1] = Math.min(e.vel[1] + 14 * DT, 2.2);
  } else {
    e.vel[1] = Math.max(e.vel[1] - 32 * DT, -60);
    if (e.def.slowFall) e.vel[1] = Math.max(e.vel[1], -3);
  }
}

function move(e, game, wish) {
  const def = e.def;
  const world = game.world;
  const speed = wish.speed * (e.inWater || e.inLava ? 0.5 : 1);
  const targetX = wish.x * speed;
  const targetZ = wish.z * speed;
  const accel = e.onGround || def.flying ? 24 : 6;
  e.vel[0] += Math.max(-accel * DT, Math.min(accel * DT, targetX - e.vel[0]));
  e.vel[2] += Math.max(-accel * DT, Math.min(accel * DT, targetZ - e.vel[2]));
  if (def.flying) {
    const want = (e.flyY ?? e.pos[1]) - e.pos[1];
    e.vel[1] += (Math.max(-3, Math.min(3, want * 2)) - e.vel[1]) * 0.2;
  } else {
    gravity(e);
    if (wish.jump && e.onGround) e.vel[1] = 8.4;
    if (def.climbs && e.collidedH && (wish.x || wish.z)) e.vel[1] = 3;
  }
  const before = e.pos[1];
  const bx = e.pos[0];
  const bz = e.pos[2];
  moveBody(world, e, e.vel[0] * DT, e.vel[1] * DT, e.vel[2] * DT);
  const moved = Math.hypot(e.pos[0] - bx, e.pos[2] - bz);
  e.limbSwing += moved * 4;
  e.limbAmount += (Math.min(1, (moved / DT) / 3) - e.limbAmount) * 0.4;
  if (moved > 0.01) {
    const yaw = Math.atan2(-(e.pos[0] - bx), -(e.pos[2] - bz));
    e.bodyYaw += wrap(yaw - e.bodyYaw) * 0.35;
  } else if (e.target) {
    e.bodyYaw += wrap(e.bodyYaw + e.headYaw - e.bodyYaw) * 0.1;
  }
  e.yaw = e.bodyYaw;
  // Falling hurts mobs too (chickens flutter down safely).
  const dy = e.pos[1] - before;
  if (e.inWater || def.flying || def.slowFall) e.fallDistance = 0;
  else if (dy < 0) e.fallDistance -= dy;
  if (e.onGround) {
    if (e.fallDistance > 3.5) hurtMob(e, Math.ceil(e.fallDistance - 3), game, { kind: 'fall' });
    e.fallDistance = 0;
  }
}

// Mobs shove each other (and get shoved out of the player) instead of stacking up.
function pushApart(e, game) {
  for (const o of game.entities.list) {
    if (o === e || o.kind !== 'mob' || o.removed || o.type === 'dragon') continue;
    const dx = e.pos[0] - o.pos[0];
    const dz = e.pos[2] - o.pos[2];
    const min = e.hw + o.hw;
    if (Math.abs(dx) < min && Math.abs(dz) < min && Math.abs(e.pos[1] - o.pos[1]) < 1) {
      const d = Math.hypot(dx, dz) || 0.01;
      e.vel[0] += (dx / d) * 0.6;
      e.vel[2] += (dz / d) * 0.6;
    }
  }
  const p = game.player;
  const dx = e.pos[0] - p.pos[0];
  const dz = e.pos[2] - p.pos[2];
  const min = e.hw + p.hw;
  if (!p.spectator && Math.abs(dx) < min && Math.abs(dz) < min && Math.abs(e.pos[1] - p.pos[1]) < 1.5) {
    const d = Math.hypot(dx, dz) || 0.01;
    e.vel[0] += (dx / d) * 0.8;
    e.vel[2] += (dz / d) * 0.8;
  }
}

function despawnCheck(e, game) {
  const p = game.player.pos;
  const d = Math.hypot(e.pos[0] - p[0], e.pos[1] - p[1], e.pos[2] - p[2]);
  if (d > 128 || (d > 32 && Math.random() < 1 / 800)) e.removed = true;
  if (game.difficulty === 'peaceful') e.removed = true;
}
