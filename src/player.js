// The player: first-person movement (walking, sprinting, sneaking, swimming,
// climbing, flying) plus survival stats ticked 20 times a second.
import { B, FLUID, CLIMBABLE, BLOCKS, SOLID } from './blocks.js';
import { moveBody, forBlocksIn, bodyBox } from './physics.js';

const EYE = 1.62;
const EYE_SNEAK = 1.32;
const GRAVITY = 32;
const JUMP_SPEED = 8.9;
const SPEED = { walk: 4.3, sprint: 5.6, sneak: 1.3, swim: 2.2, swimSprint: 3.2, fly: 10.9, flySprint: 21.6, spectator: 14 };

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

export class Player {
  constructor() {
    this.pos = [0, 80, 0];
    this.vel = [0, 0, 0];
    this.hw = 0.3;
    this.h = 1.8;
    this.stepHeight = 0.6;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.mode = 'survival';
    this.inWater = false;
    this.inLava = false;
    this.headInWater = false;
    this.onLadder = false;
    this.sprinting = false;
    this.sneaking = false;
    this.eyeHeight = EYE;
    this.walkDist = 0;
    this.collidedH = false;
    this.autoJump = false;
    this.fallDistance = 0;
    // Experience survives respawning stats; death takes it separately.
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.enchantSeed = (Math.random() * 2 ** 31) | 0;
    this.resetStats();
  }

  resetStats() {
    this.health = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fireTicks = 0;
    this.hurtTicks = 0;
    this.invulnerable = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.regenEffect = 0;
    this.dead = false;
    this.fallDistance = 0;
  }

  get creative() {
    return this.mode === 'creative';
  }

  get spectator() {
    return this.mode === 'spectator';
  }

  // Survival-style rules apply (damage, hunger, timed mining).
  get vulnerable() {
    return this.mode === 'survival';
  }

  get eye() {
    return [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
  }

  // yaw 0 looks toward -z; positive pitch looks up.
  get look() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  teleport(x, y, z) {
    this.pos = [x, y, z];
    this.vel = [0, 0, 0];
    this.fallDistance = 0;
  }

  box(grow = 0) {
    return bodyBox(this, grow);
  }

  // Does the player's body overlap the box (block units, world space)?
  intersects(b) {
    const p = this.pos;
    return p[0] + this.hw > b[0] && p[0] - this.hw < b[3] && p[1] + this.h > b[1] && p[1] < b[4] && p[2] + this.hw > b[2] && p[2] - this.hw < b[5];
  }

  // input: { forward, strafe (-1..1), jump, sneak, sprint }. Returns events for the game.
  update(dt, input, world) {
    const p = this.pos;
    const v = this.vel;
    const events = { enteredWater: false, fallDamage: 0, touching: null };
    const wasInWater = this.inWater;
    this.scanSurroundings(world);
    events.enteredWater = !wasInWater && this.inWater;

    if (this.spectator) {
      this.flying = true;
      this.flyMove(dt, input, true);
      p[0] += v[0] * dt;
      p[1] += v[1] * dt;
      p[2] += v[2] * dt;
      this.onGround = false;
      this.fallDistance = 0;
      this.eyeHeight = EYE;
      return events;
    }

    this.sneaking = !this.flying && input.sneak;
    const canSprint = this.creative || this.food > 6;
    if (input.sprint && input.forward > 0 && !this.sneaking && canSprint) this.sprinting = true;
    if (input.forward <= 0 || this.sneaking || !canSprint || this.collidedH) this.sprinting = false;

    if (this.flying) {
      this.flyMove(dt, input, false);
    } else {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      let mx = -input.forward * sin + input.strafe * cos;
      let mz = -input.forward * cos - input.strafe * sin;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      let speed;
      if (this.inWater || this.inLava) speed = this.sprinting ? SPEED.swimSprint : SPEED.swim;
      else if (this.sneaking) speed = SPEED.sneak;
      else speed = this.sprinting ? SPEED.sprint : SPEED.walk;
      if (this.inLava) speed *= 0.5;
      const ground = world.getBlock(Math.floor(p[0]), Math.floor(p[1] - 0.2), Math.floor(p[2]));
      if (this.onGround && BLOCKS[ground].slows) speed *= 0.45;
      const slippery = this.onGround && BLOCKS[ground].slippery;
      const accel = this.onGround ? (slippery ? 7 : 60) : 18;
      v[0] = approach(v[0], mx * speed, accel * dt);
      v[2] = approach(v[2], mz * speed, accel * dt);

      if (this.inWater || this.inLava) {
        v[1] -= (this.inLava ? 6 : 12) * dt;
        v[1] *= Math.max(0, 1 - 2.5 * dt);
        if (input.jump) v[1] = Math.min(v[1] + 32 * dt, this.inLava ? 2 : 3.4);
        // Kick up out of the water when swimming against a ledge.
        if (input.jump && this.collidedH) v[1] = Math.max(v[1], 6);
        v[1] = Math.max(v[1], -5);
      } else if (this.onLadder) {
        v[1] = Math.max(v[1] - GRAVITY * dt, -2.4);
        if (this.collidedH || input.jump) v[1] = 2.4;
        else if (this.sneaking) v[1] = Math.max(v[1], 0);
      } else {
        v[1] = Math.max(v[1] - GRAVITY * dt, -60);
        if (input.jump && this.onGround) {
          v[1] = JUMP_SPEED;
          this.onGround = false;
          this.exhaustion += this.sprinting ? 0.2 : 0.05;
        }
      }
      if (this.autoJump && this.onGround && len > 0.1 && this.stepAhead(world, mx, mz)) v[1] = JUMP_SPEED;
    }

    const before = [p[0], p[1], p[2]];
    const guard = this.sneaking && this.onGround;
    moveBody(world, this, v[0] * dt, v[1] * dt, v[2] * dt);
    // Sneaking keeps you from walking off ledges.
    if (guard && !this.supported(world)) {
      p[0] = before[0];
      p[2] = before[2];
      moveBody(world, this, 0, -0.001, 0);
      if (!this.supported(world)) { p[0] = before[0]; p[2] = before[2]; }
    }
    if (this.onGround && this.flying) this.flying = false;

    // Falling: fall distance turns into damage on landing; water and ladders break the fall.
    const dy = p[1] - before[1];
    if (this.inWater || this.onLadder || this.flying) this.fallDistance = 0;
    else if (dy < 0) this.fallDistance -= dy;
    if (this.onGround) {
      if (this.fallDistance > 3.4) events.fallDamage = Math.ceil(this.fallDistance - 3);
      this.fallDistance = 0;
    }
    const moved = Math.hypot(p[0] - before[0], p[2] - before[2]);
    if (this.onGround) this.walkDist += moved;
    if (this.vulnerable) {
      if (this.sprinting) this.exhaustion += moved * 0.1;
      else if (this.inWater) this.exhaustion += moved * 0.01;
    }

    const targetEye = this.sneaking ? EYE_SNEAK : EYE;
    this.eyeHeight = approach(this.eyeHeight, targetEye, 4 * dt);
    return events;
  }

  flyMove(dt, input, fast) {
    const v = this.vel;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -input.forward * sin + input.strafe * cos;
    let mz = -input.forward * cos - input.strafe * sin;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = fast ? SPEED.spectator * (input.sprint ? 2 : 1) : input.sprint ? SPEED.flySprint : SPEED.fly;
    this.sprinting = input.sprint && input.forward > 0;
    v[0] = approach(v[0], mx * speed, 40 * dt);
    v[2] = approach(v[2], mz * speed, 40 * dt);
    const dir = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
    v[1] = approach(v[1], dir * (fast ? 12 : 8), 50 * dt);
  }

  scanSurroundings(world) {
    const p = this.pos;
    const at = (x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z), B.AIR);
    const feet = at(p[0], p[1] + 0.2, p[2]);
    const waist = at(p[0], p[1] + 0.9, p[2]);
    this.inWater = FLUID[feet] === 1 || FLUID[waist] === 1;
    this.inLava = FLUID[feet] === 2 || FLUID[waist] === 2;
    this.headInWater = FLUID[at(p[0], p[1] + this.eyeHeight, p[2])] === 1;
    const b = this.box(0.02);
    this.onLadder = forBlocksIn(world, b[0], b[1], b[2], b[3], b[4], b[5], (id) => CLIMBABLE[id] === 1);
  }

  supported(world) {
    const b = this.box();
    let found = false;
    forBlocksIn(world, b[0] + 0.001, b[1] - 0.6, b[2] + 0.001, b[3] - 0.001, b[1] - 0.001, b[5] - 0.001, (id) => {
      if (SOLID[id]) found = true;
      return found;
    });
    return found;
  }

  // Is there a one-block step directly ahead that a jump would clear?
  stepAhead(world, mx, mz) {
    const len = Math.hypot(mx, mz);
    const fx = Math.floor(this.pos[0] + (mx / len) * (this.hw + 0.35));
    const fz = Math.floor(this.pos[2] + (mz / len) * (this.hw + 0.35));
    const fy = Math.floor(this.pos[1] + 0.01);
    return SOLID[world.getBlock(fx, fy, fz)] && !SOLID[world.getBlock(fx, fy + 1, fz)] && !SOLID[world.getBlock(fx, fy + 2, fz)];
  }
}
