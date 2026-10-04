// Entities: dropped items, projectiles, primed TNT, end crystals and mobs.
// Everything ticks at 20 per second; the renderer interpolates between ticks.
import { SOLID, FLUID } from './blocks.js';
import { moveBody, boxesOverlap, shapesAt } from './physics.js';
import { canStack, clone } from './inventory.js';
import { maxStack } from './items.js';
import { MOBS, tickMob, createMob, createSlime } from './mobs.js';

let nextId = 1;
const DT = 0.05;

export class Entity {
  constructor(kind, type, x, y, z) {
    this.id = nextId++;
    this.kind = kind;
    this.type = type;
    this.pos = [x, y, z];
    this.prev = [x, y, z];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.prevYaw = 0;
    this.pitch = 0;
    this.hw = 0.125;
    this.h = 0.25;
    this.stepHeight = 0;
    this.onGround = false;
    this.collidedH = false;
    this.age = 0;
    this.removed = false;
  }

  box(grow = 0) {
    const p = this.pos;
    return [p[0] - this.hw - grow, p[1] - grow, p[2] - this.hw - grow, p[0] + this.hw + grow, p[1] + this.h + grow, p[2] + this.hw + grow];
  }

  centre() {
    return [this.pos[0], this.pos[1] + this.h / 2, this.pos[2]];
  }
}

export function itemEntity(stack, x, y, z, vel = null, delay = 10) {
  const e = new Entity('item', 'item', x, y, z);
  e.stack = clone(stack);
  e.vel = vel ?? [(Math.random() - 0.5) * 2, 3 + Math.random(), (Math.random() - 0.5) * 2];
  e.pickupDelay = delay;
  e.spin = Math.random() * Math.PI * 2;
  return e;
}

// An experience orb worth `value` points; it drifts to a nearby player.
export function xpOrb(value, x, y, z) {
  const e = new Entity('xp', 'xp', x, y, z);
  e.value = value;
  e.hw = 0.125;
  e.h = 0.25;
  e.vel = [(Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4];
  e.pickupDelay = 10;
  e.spin = Math.random() * 100;
  return e;
}

export function projectile(type, x, y, z, vel, owner) {
  const e = new Entity('projectile', type, x, y, z);
  e.vel = [...vel];
  e.owner = owner;
  e.hw = 0.1;
  e.h = 0.2;
  e.inGround = false;
  return e;
}

export function primedTnt(x, y, z, fuse = 80) {
  const e = new Entity('tnt', 'tnt', x + 0.5, y, z + 0.5);
  e.fuse = fuse;
  e.hw = 0.49;
  e.h = 0.98;
  e.vel = [(Math.random() - 0.5) * 0.4, 4, (Math.random() - 0.5) * 0.4];
  return e;
}

export function endCrystal(x, y, z) {
  const e = new Entity('crystal', 'crystal', x, y, z);
  e.hw = 1;
  e.h = 2;
  e.health = 1;
  return e;
}

// Slab test: distance along the ray to the box, or -1.
export function rayBox(o, d, b, maxDist) {
  let t0 = 0;
  let t1 = maxDist;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return -1;
    } else {
      let near = (b[a] - o[a]) / d[a];
      let far = (b[a + 3] - o[a]) / d[a];
      if (near > far) [near, far] = [far, near];
      t0 = Math.max(t0, near);
      t1 = Math.min(t1, far);
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

// First block collision box along a segment, for fast projectiles.
function segmentHitsBlock(world, from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return null;
  const dir = [d[0] / len, d[1] / len, d[2] / len];
  const steps = Math.ceil(len / 0.2);
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(len, s * 0.2);
    const x = Math.floor(from[0] + dir[0] * t);
    const y = Math.floor(from[1] + dir[1] * t);
    const z = Math.floor(from[2] + dir[2] * t);
    const id = world.getBlock(x, y, z);
    const shapes = shapesAt(world, x, y, z, id);
    if (!shapes) continue;
    for (const sh of shapes) {
      const hit = rayBox(from, dir, [x + sh[0], y + sh[1], z + sh[2], x + sh[3], y + sh[4], z + sh[5]], len);
      if (hit >= 0) return { t: hit, x, y, z, id, point: [from[0] + dir[0] * hit, from[1] + dir[1] * hit, from[2] + dir[2] * hit] };
    }
  }
  return null;
}

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  add(e) {
    this.list.push(e);
    return e;
  }

  clear() {
    this.list = [];
  }

  mobs(filter) {
    return this.list.filter((e) => e.kind === 'mob' && !e.removed && (!filter || filter(e)));
  }

  count(filter) {
    let n = 0;
    for (const e of this.list) if (!e.removed && filter(e)) n++;
    return n;
  }

  inBox(box, filter) {
    return this.list.filter((e) => !e.removed && boxesOverlap(e.box(), box) && (!filter || filter(e)));
  }

  // Nearest entity hit by a ray (that passes `filter`), with its distance.
  raycast(origin, dir, maxDist, filter) {
    let best = null;
    for (const e of this.list) {
      if (e.removed || (filter && !filter(e))) continue;
      const t = rayBox(origin, dir, e.box(e.kind === 'mob' ? 0.1 : 0), maxDist);
      if (t >= 0 && (!best || t < best.distance)) best = { entity: e, distance: t };
    }
    return best;
  }

  tick() {
    const game = this.game;
    for (const e of this.list) {
      if (e.removed) continue;
      e.prev[0] = e.pos[0];
      e.prev[1] = e.pos[1];
      e.prev[2] = e.pos[2];
      e.prevYaw = e.yaw;
      e.prevBodyYaw = e.bodyYaw;
      e.age++;
      switch (e.kind) {
        case 'item': this.tickItem(e); break;
        case 'xp': this.tickXp(e); break;
        case 'projectile': this.tickProjectile(e); break;
        case 'tnt': this.tickTnt(e); break;
        case 'mob': tickMob(e, game); break;
        default: break;
      }
      if (e.pos[1] < -64) e.removed = true;
    }
    if (game.tickCount % 20 === 0) this.mergeItems();
    this.list = this.list.filter((e) => !e.removed);
  }

  fall(e, gravity, drag) {
    const world = this.game.world;
    const inFluid = FLUID[world.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1] + 0.1), Math.floor(e.pos[2]))];
    if (inFluid) {
      e.vel[1] = Math.min(e.vel[1] + 8 * DT, 1.2);
      e.vel[0] *= 0.9;
      e.vel[2] *= 0.9;
    } else {
      e.vel[1] = Math.max(e.vel[1] - gravity * DT, -40);
    }
    moveBody(world, e, e.vel[0] * DT, e.vel[1] * DT, e.vel[2] * DT);
    if (e.onGround) {
      e.vel[0] *= drag;
      e.vel[2] *= drag;
    }
    return inFluid;
  }

  tickItem(e) {
    const game = this.game;
    const fluid = this.fall(e, 32, 0.6);
    if (fluid === 2) {
      e.removed = true;
      game.particles.burst(e.pos, 'smoke', 4);
      game.sound('fizz', e.pos);
      return;
    }
    if (e.pickupDelay > 0) e.pickupDelay--;
    if (e.age > 6000) e.removed = true;
    const p = game.player;
    if (!e.pickupDelay && !p.dead && !p.spectator && game.state !== 'dead') {
      const near = Math.abs(p.pos[0] - e.pos[0]) < 1.4 && Math.abs(p.pos[2] - e.pos[2]) < 1.4 &&
        e.pos[1] > p.pos[1] - 0.8 && e.pos[1] < p.pos[1] + p.h + 0.5;
      if (near) {
        const left = game.inventory.give(e.stack);
        if (left < e.stack.count) {
          game.sound('pop', e.pos);
          game.onPickup?.(e.stack.item, e.stack.count - left);
          if (left === 0) e.removed = true;
          else e.stack.count = left;
          game.hud?.refreshHotbar();
        }
      }
    }
  }

  tickXp(e) {
    const game = this.game;
    const p = game.player;
    const fluid = this.fall(e, 12, 0.7);
    if (fluid === 2) {
      e.removed = true;
      return;
    }
    if (e.age > 6000) e.removed = true;
    if (e.pickupDelay > 0) {
      e.pickupDelay--;
      return;
    }
    if (p.dead || p.spectator || game.state === 'dead') return;
    const dx = p.pos[0] - e.pos[0];
    const dy = p.pos[1] + 0.9 - e.pos[1];
    const dz = p.pos[2] - e.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 8) {
      // Pulled in harder the closer it gets, like Minecraft's orbs.
      const pull = (1 - d / 8) ** 2 * 3;
      e.vel[0] = e.vel[0] * 0.88 + (dx / d) * pull;
      e.vel[1] = e.vel[1] * 0.88 + (dy / d) * pull + 0.5;
      e.vel[2] = e.vel[2] * 0.88 + (dz / d) * pull;
    }
    if (d < 1.2 && (p.xpCooldown ?? 0) <= 0) {
      p.xpCooldown = 2;
      e.removed = true;
      game.addXp(e.value);
    }
  }

  mergeItems() {
    const items = this.list.filter((e) => e.kind === 'item' && !e.removed);
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.removed || a.stack.count >= maxStack(a.stack.item)) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.removed || !canStack(a.stack, b.stack)) continue;
        if (Math.abs(a.pos[0] - b.pos[0]) > 0.6 || Math.abs(a.pos[1] - b.pos[1]) > 0.6 || Math.abs(a.pos[2] - b.pos[2]) > 0.6) continue;
        const n = Math.min(maxStack(a.stack.item) - a.stack.count, b.stack.count);
        a.stack.count += n;
        b.stack.count -= n;
        if (b.stack.count <= 0) b.removed = true;
      }
    }
  }

  tickTnt(e) {
    this.fall(e, 32, 0.7);
    e.fuse--;
    if (e.fuse <= 0) {
      e.removed = true;
      this.game.explode(e.pos[0], e.pos[1] + 0.5, e.pos[2], 4, { source: e });
    } else if (e.fuse % 5 === 0) {
      this.game.particles.burst([e.pos[0], e.pos[1] + 1, e.pos[2]], 'smoke', 1);
    }
  }

  tickProjectile(e) {
    const game = this.game;
    const world = game.world;
    if (e.type === 'eye') return this.tickEye(e);
    if (e.inGround) {
      // Arrows stuck in a block wait to be picked up, or fall if the block goes.
      if (!SOLID[world.getBlock(e.stuck[0], e.stuck[1], e.stuck[2])]) {
        e.inGround = false;
        e.vel = [0, -1, 0];
      } else {
        if (e.age > 1200) e.removed = true;
        const p = game.player;
        if (e.pickup && Math.hypot(p.pos[0] - e.pos[0], p.pos[1] + 0.9 - e.pos[1], p.pos[2] - e.pos[2]) < 1.6) {
          if (game.inventory.give({ item: 'arrow', count: 1 }) === 0) {
            e.removed = true;
            game.sound('pop', e.pos);
            game.hud?.refreshHotbar();
          }
        }
        return;
      }
    }
    const gravity = { arrow: 20, pearl: 12, fireball: 0, ghast_fireball: 0 }[e.type] ?? 12;
    e.vel[1] -= gravity * DT;
    if (e.type === 'arrow') {
      e.vel[0] *= 0.99; e.vel[1] *= 0.99; e.vel[2] *= 0.99;
      if (FLUID[world.getBlock(Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2]))] === 1) {
        e.vel[0] *= 0.8; e.vel[1] *= 0.8; e.vel[2] *= 0.8;
      }
    }
    const from = [...e.pos];
    const to = [e.pos[0] + e.vel[0] * DT, e.pos[1] + e.vel[1] * DT, e.pos[2] + e.vel[2] * DT];
    const speed = Math.hypot(e.vel[0], e.vel[1], e.vel[2]);
    e.yaw = Math.atan2(-e.vel[0], -e.vel[2]);
    e.pitch = Math.asin(Math.max(-1, Math.min(1, e.vel[1] / (speed || 1))));
    const blockHit = segmentHitsBlock(world, from, to);
    const dist = blockHit ? blockHit.t : Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const dir = speed > 0 ? [e.vel[0] / speed, e.vel[1] / speed, e.vel[2] / speed] : [0, -1, 0];
    // Entities (and the player) in the way?
    let hitEntity = null;
    let hitDist = dist;
    for (const other of this.list) {
      if (other === e || other.removed || other.id === e.owner || other.kind === 'item' || other.kind === 'projectile') continue;
      if (other.kind === 'mob' && other.deathTime > 0) continue;
      const t = rayBox(from, dir, other.box(0.2), hitDist);
      if (t >= 0 && t <= hitDist) { hitEntity = other; hitDist = t; }
    }
    const p = game.player;
    let hitPlayer = false;
    if (e.owner !== 'player' && !p.dead && !p.spectator) {
      const t = rayBox(from, dir, p.box(0.1), hitDist);
      if (t >= 0 && t <= hitDist) { hitPlayer = true; hitEntity = null; hitDist = t; }
    }
    if (hitPlayer || hitEntity) {
      const target = hitPlayer ? 'player' : hitEntity;
      game.projectileHit(e, target, speed);
      return;
    }
    if (blockHit) {
      e.pos = blockHit.point;
      game.projectileHitBlock(e, blockHit);
      if (e.type === 'arrow' && !e.removed) {
        e.inGround = true;
        e.stuck = [blockHit.x, blockHit.y, blockHit.z];
        e.vel = [0, 0, 0];
        e.age = 0;
        game.sound('arrow_hit', e.pos);
      }
      return;
    }
    e.pos = to;
    if (e.type === 'fireball' || e.type === 'ghast_fireball') {
      game.particles.burst(e.pos, 'flame', 1, 0.05);
      if (e.age > 200) e.removed = true;
    }
    if (e.age > 1200) e.removed = true;
  }

  // Thrown eye of ender: rises and drifts toward the stronghold, then drops.
  tickEye(e) {
    const game = this.game;
    const dx = e.target[0] - e.pos[0];
    const dz = e.target[2] - e.pos[2];
    const flat = Math.hypot(dx, dz);
    const speed = 6;
    const reach = Math.min(flat, 12);
    const goal = [e.start[0] + (dx / (flat || 1)) * reach, e.start[1] + (flat < 12 ? -1 : 8), e.start[2] + (dz / (flat || 1)) * reach];
    if (flat < 1.5) goal[1] = e.pos[1] - 1;
    for (let a = 0; a < 3; a++) {
      const want = goal[a] - e.pos[a];
      e.vel[a] += (Math.max(-speed, Math.min(speed, want * 2)) - e.vel[a]) * 0.1;
      e.pos[a] += e.vel[a] * DT;
    }
    game.particles.burst(e.pos, 'portal', 1, 0.1);
    if (e.age > 70) {
      e.removed = true;
      if (Math.random() < 0.8) game.entities.add(itemEntity({ item: 'eye_of_ender', count: 1 }, e.pos[0], e.pos[1], e.pos[2], [0, 1, 0], 10));
      else {
        game.sound('glass', e.pos);
        game.particles.burst(e.pos, 'portal', 12, 0.4);
      }
    }
  }

  serialize(filter) {
    const out = [];
    for (const e of this.list) {
      if (e.removed || (filter && !filter(e))) continue;
      const s = serializeEntity(e);
      if (s) out.push(s);
    }
    return out;
  }
}

export function serializeEntity(e) {
  const base = { kind: e.kind, type: e.type, pos: e.pos.map((v) => Math.round(v * 100) / 100), yaw: e.yaw };
  if (e.kind === 'item') return { ...base, stack: e.stack, age: e.age };
  if (e.kind === 'mob') {
    if ((MOBS[e.type].hostile || MOBS[e.type].despawn) && !e.persistent) return null;
    const out = { ...base, health: e.health, baby: e.growUp ?? 0, sheared: !!e.sheared, persistent: !!e.persistent };
    if (e.tamed) Object.assign(out, { tamed: true, sitting: !!e.sitting });
    if (e.size) out.size = e.size;
    return out;
  }
  if (e.kind === 'crystal') return { ...base };
  if (e.kind === 'xp') return { ...base, value: e.value, age: e.age };
  return null;
}

export function deserializeEntity(s) {
  if (!s || !s.pos) return null;
  const [x, y, z] = s.pos;
  if (s.kind === 'item') {
    const e = itemEntity(s.stack, x, y, z, [0, 0, 0], 0);
    e.age = s.age ?? 0;
    return e;
  }
  if (s.kind === 'mob' && MOBS[s.type]) {
    const e = s.type === 'slime' ? createSlime(s.size ?? 1, x, y, z) : createMob(s.type, x, y, z);
    e.health = s.health ?? e.health;
    e.yaw = e.bodyYaw = s.yaw ?? 0;
    if (s.baby) e.growUp = s.baby;
    e.sheared = s.sheared;
    e.persistent = s.persistent;
    e.tamed = !!s.tamed;
    e.sitting = !!s.sitting;
    return e;
  }
  if (s.kind === 'crystal') return endCrystal(x, y, z);
  if (s.kind === 'xp') {
    const e = xpOrb(s.value ?? 1, x, y, z);
    e.vel = [0, 0, 0];
    e.age = s.age ?? 0;
    return e;
  }
  return null;
}

