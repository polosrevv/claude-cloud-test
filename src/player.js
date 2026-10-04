// First-person movement: walking, sprinting, sneaking, swimming and creative
// flight, with axis-by-axis collision against solid blocks.
import { B, SOLID } from './blocks.js';

const HALF_WIDTH = 0.3;
const BODY_HEIGHT = 1.8;
const EYE = 1.62;
const EYE_SNEAK = 1.32;
const GRAVITY = 32;
const JUMP_SPEED = 8.9;
const GAP = 1e-3;

const SPEED = { walk: 4.3, sprint: 5.6, sneak: 1.3, swim: 2.2, swimSprint: 3.2, fly: 10.9, flySprint: 21.6 };

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

export class Player {
  constructor() {
    this.pos = [0, 80, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.sprinting = false;
    this.sneaking = false;
    this.eyeHeight = EYE;
    this.walkDist = 0;
    this.collidedH = false;
    this.autoJump = false;
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
  }

  // Does the player's body overlap block (x, y, z)?
  intersectsBlock(x, y, z) {
    const p = this.pos;
    return p[0] + HALF_WIDTH > x && p[0] - HALF_WIDTH < x + 1 &&
      p[1] + BODY_HEIGHT > y && p[1] < y + 1 &&
      p[2] + HALF_WIDTH > z && p[2] - HALF_WIDTH < z + 1;
  }

  // input: { forward, strafe (-1..1), jump, sneak, sprint }
  update(dt, input, world) {
    const p = this.pos;
    const v = this.vel;
    const at = (x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z), B.BEDROCK);
    const wasInWater = this.inWater;
    this.inWater = at(p[0], p[1] + 0.2, p[2]) === B.WATER || at(p[0], p[1] + 0.9, p[2]) === B.WATER;
    this.headInWater = at(p[0], p[1] + this.eyeHeight, p[2]) === B.WATER;
    this.sneaking = !this.flying && input.sneak;
    if (input.sprint && input.forward > 0 && !this.sneaking) this.sprinting = true;
    if (input.forward <= 0 || this.sneaking) this.sprinting = false;

    // Desired horizontal velocity in world space.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -input.forward * sin + input.strafe * cos;
    let mz = -input.forward * cos - input.strafe * sin;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    let speed;
    if (this.flying) speed = this.sprinting ? SPEED.flySprint : SPEED.fly;
    else if (this.inWater) speed = this.sprinting ? SPEED.swimSprint : SPEED.swim;
    else if (this.sneaking) speed = SPEED.sneak;
    else speed = this.sprinting ? SPEED.sprint : SPEED.walk;
    const accel = this.flying ? 40 : this.onGround ? 60 : 18;
    v[0] = approach(v[0], mx * speed, accel * dt);
    v[2] = approach(v[2], mz * speed, accel * dt);

    if (this.flying) {
      const dir = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      v[1] = approach(v[1], dir * 8, 50 * dt);
    } else if (this.inWater) {
      v[1] -= 12 * dt;
      v[1] *= Math.max(0, 1 - 2.5 * dt);
      if (input.jump) v[1] = Math.min(v[1] + 32 * dt, 3.4);
      // Kick up out of the water when swimming against a ledge.
      if (input.jump && this.collidedH) v[1] = Math.max(v[1], 6);
      v[1] = Math.max(v[1], -5);
    } else {
      v[1] = Math.max(v[1] - GRAVITY * dt, -60);
      if (input.jump && this.onGround) {
        v[1] = JUMP_SPEED;
        this.onGround = false;
      }
    }

    if (this.autoJump && this.onGround && !this.flying && len > 0.1 && this.stepAhead(world, mx, mz)) {
      v[1] = JUMP_SPEED;
    }

    const groundedBefore = this.onGround;
    const before = [p[0], p[2]];
    this.move(world, dt, this.sneaking && groundedBefore);
    if (this.onGround && this.flying) this.flying = false;
    if (this.onGround) this.walkDist += Math.hypot(p[0] - before[0], p[2] - before[1]);

    const targetEye = this.sneaking ? EYE_SNEAK : EYE;
    this.eyeHeight = approach(this.eyeHeight, targetEye, 4 * dt);
    return { enteredWater: !wasInWater && this.inWater };
  }

  // Is there a one-block step directly ahead that a jump would clear?
  stepAhead(world, mx, mz) {
    const len = Math.hypot(mx, mz);
    const fx = Math.floor(this.pos[0] + (mx / len) * (HALF_WIDTH + 0.35));
    const fz = Math.floor(this.pos[2] + (mz / len) * (HALF_WIDTH + 0.35));
    const fy = Math.floor(this.pos[1] + 0.01);
    return SOLID[world.getBlock(fx, fy, fz)] && !SOLID[world.getBlock(fx, fy + 1, fz)] && !SOLID[world.getBlock(fx, fy + 2, fz)];
  }

  move(world, dt, guardEdges) {
    const v = this.vel;
    const p = this.pos;
    const fastest = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) * dt;
    const steps = Math.max(1, Math.ceil(fastest / 0.4));
    const sdt = dt / steps;
    this.onGround = false;
    this.collidedH = false;
    for (let s = 0; s < steps; s++) {
      if (v[1] !== 0 && this.sweep(world, 1, v[1] * sdt)) {
        if (v[1] < 0) this.onGround = true;
        v[1] = 0;
      }
      for (const axis of [0, 2]) {
        const d = v[axis] * sdt;
        if (d === 0) continue;
        const prev = p[axis];
        if (this.sweep(world, axis, d)) {
          v[axis] = 0;
          this.collidedH = true;
        }
        // Sneaking keeps you from walking off ledges.
        if (guardEdges && !this.hasGroundBelow(world)) {
          p[axis] = prev;
          v[axis] = 0;
        }
      }
    }
  }

  // Move along one axis and push back out of any solid block. Returns true on contact.
  sweep(world, axis, d) {
    const p = this.pos;
    p[axis] += d;
    const x0 = Math.floor(p[0] - HALF_WIDTH);
    const x1 = Math.floor(p[0] + HALF_WIDTH);
    const y0 = Math.floor(p[1]);
    const y1 = Math.floor(p[1] + BODY_HEIGHT);
    const z0 = Math.floor(p[2] - HALF_WIDTH);
    const z1 = Math.floor(p[2] + HALF_WIDTH);
    let hit = false;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!SOLID[world.getBlock(x, y, z, B.BEDROCK)]) continue;
          hit = true;
          if (axis === 0) p[0] = d > 0 ? Math.min(p[0], x - HALF_WIDTH - GAP) : Math.max(p[0], x + 1 + HALF_WIDTH + GAP);
          else if (axis === 1) p[1] = d > 0 ? Math.min(p[1], y - BODY_HEIGHT - GAP) : Math.max(p[1], y + 1 + GAP);
          else p[2] = d > 0 ? Math.min(p[2], z - HALF_WIDTH - GAP) : Math.max(p[2], z + 1 + HALF_WIDTH + GAP);
        }
      }
    }
    return hit;
  }

  hasGroundBelow(world) {
    const p = this.pos;
    const y = Math.floor(p[1] - 0.05);
    for (let z = Math.floor(p[2] - HALF_WIDTH); z <= Math.floor(p[2] + HALF_WIDTH); z++) {
      for (let x = Math.floor(p[0] - HALF_WIDTH); x <= Math.floor(p[0] + HALF_WIDTH); x++) {
        if (SOLID[world.getBlock(x, y, z, B.BEDROCK)]) return true;
      }
    }
    return false;
  }
}
