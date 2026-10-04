// The Ender Dragon fight. The dragon circles the pillars, dives at the player,
// sometimes perches on the exit portal, and heals from end crystals until they
// are destroyed. Killing it opens the exit portal home.
import { B } from './blocks.js';
import { createMob, hurtMob } from './mobs.js';
import { endCrystal } from './entities.js';

const DT = 0.05;

export class DragonFight {
  constructor(game, state) {
    this.game = game;
    this.state = state; // { killed, started } persisted with the world
  }

  get terrain() {
    return this.game.worlds.end.terrain;
  }

  // Called when the player arrives in the End.
  begin() {
    const game = this.game;
    if (this.state.killed) {
      this.openPortal();
      return;
    }
    const ents = game.entities;
    if (!ents.list.some((e) => e.kind === 'crystal')) {
      for (const p of this.terrain.pillars) ents.add(endCrystal(...p.crystal));
    }
    if (!ents.list.some((e) => e.type === 'dragon')) {
      const d = createMob('dragon', 0, 90, -60);
      d.phase = 'circle';
      d.angle = 0;
      d.phaseTime = 0;
      d.stuck = 0;
      ents.add(d);
    }
    this.state.started = true;
  }

  dragon() {
    return this.game.entities.list.find((e) => e.type === 'dragon' && !e.removed);
  }

  tick() {
    const game = this.game;
    const d = this.dragon();
    if (!d) {
      game.hud.bossBar(null);
      return;
    }
    game.hud.bossBar('Ender Dragon', d.health / d.def.health);
    // Crystals heal the dragon while it is close to one.
    let healer = null;
    let best = 32;
    for (const e of game.entities.list) {
      if (e.kind !== 'crystal' || e.removed) continue;
      const dist = Math.hypot(e.pos[0] - d.pos[0], e.pos[1] - d.pos[1], e.pos[2] - d.pos[2]);
      if (dist < best) { best = dist; healer = e; }
    }
    d.healer = healer && d.deathTime === 0 ? healer : null;
    if (d.healer && game.tickCount % 10 === 0) d.health = Math.min(d.def.health, d.health + 1);
  }

  // Crystal destroyed: it explodes, and hurts the dragon if it was feeding it.
  crystalDestroyed(crystal) {
    const game = this.game;
    crystal.removed = true;
    game.explode(crystal.pos[0], crystal.pos[1], crystal.pos[2], 6, { griefing: false });
    const d = this.dragon();
    if (d && d.healer === crystal) hurtMob(d, 10, game, { kind: 'explosion' });
  }

  tickDragon(d) {
    const game = this.game;
    const p = game.player;
    const portal = [0.5, this.terrain.portalY + 4, 0.5];
    if (d.deathTime > 0) return this.dying(d);
    d.phaseTime++;
    if (d.hurtTime > 0) d.hurtTime--;
    if (d.invuln > 0) d.invuln--;
    if (d.invuln === 0) d.lastDamage = 0;
    let target;
    let speed = 14;
    if (d.phase === 'circle') {
      d.angle = d.angle ?? 0;
      const r = 60;
      target = [Math.cos(d.angle) * r, 82 + Math.sin(d.angle * 3) * 8, Math.sin(d.angle) * r];
      if (Math.hypot(target[0] - d.pos[0], target[2] - d.pos[2]) < 12) d.angle += 0.5;
      if (d.phaseTime > 300 + Math.random() * 300 && !p.dead && p.vulnerable) {
        d.phase = Math.random() < 0.55 ? 'strafe' : 'perch';
        d.phaseTime = 0;
      }
    } else if (d.phase === 'strafe') {
      target = [p.pos[0], p.pos[1] + 1, p.pos[2]];
      speed = 18;
      const dist = Math.hypot(target[0] - d.pos[0], target[1] - d.pos[1], target[2] - d.pos[2]);
      if (dist < 3 || d.phaseTime > 140 || p.dead) {
        d.phase = 'circle';
        d.phaseTime = 0;
        d.angle = Math.atan2(d.pos[2], d.pos[0]) + 1;
      }
    } else if (d.phase === 'perch') {
      target = portal;
      speed = 10;
      const dist = Math.hypot(target[0] - d.pos[0], target[1] - d.pos[1], target[2] - d.pos[2]);
      if (dist < 2) {
        d.perched = (d.perched ?? 0) + 1;
        d.vel = [0, 0, 0];
        d.pos = [...portal];
        const dx = p.pos[0] - d.pos[0];
        const dz = p.pos[2] - d.pos[2];
        d.yaw = d.bodyYaw = Math.atan2(-dx, -dz);
        d.headPitch = -0.4;
        if (d.perched > 200) {
          d.phase = 'circle';
          d.perched = 0;
          d.phaseTime = 0;
          d.vel = [0, 8, 0];
        }
        this.touch(d);
        return;
      }
    }
    // Fly toward the target, turning smoothly.
    const dx = target[0] - d.pos[0];
    const dy = target[1] - d.pos[1];
    const dz = target[2] - d.pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    for (const [a, v] of [[0, dx], [1, dy], [2, dz]]) d.vel[a] += ((v / len) * speed - d.vel[a]) * 0.06;
    d.pos[0] += d.vel[0] * DT;
    d.pos[1] += d.vel[1] * DT;
    d.pos[2] += d.vel[2] * DT;
    const want = Math.atan2(-d.vel[0], -d.vel[2]);
    let diff = want - d.bodyYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    d.bodyYaw += diff * 0.15;
    d.yaw = d.bodyYaw;
    d.headPitch = Math.max(-0.6, Math.min(0.6, d.vel[1] / speed));
    if (game.tickCount % 80 === 0) game.sound('dragon_flap', d.pos);
    this.touch(d);
  }

  // Wings and body knock the player away.
  touch(d) {
    const game = this.game;
    const p = game.player;
    if (p.dead || !p.vulnerable) return;
    const b = d.box();
    const pb = p.box();
    const hit = pb[0] < b[3] + 2 && pb[3] > b[0] - 2 && pb[1] < b[4] && pb[4] > b[1] && pb[2] < b[5] + 2 && pb[5] > b[2] - 2;
    if (hit && (d.contactCooldown ?? 0) <= 0) {
      d.contactCooldown = 20;
      game.damagePlayer(10, 'dragon', d);
      const dx = p.pos[0] - d.pos[0];
      const dz = p.pos[2] - d.pos[2];
      const l = Math.hypot(dx, dz) || 1;
      p.vel[0] += (dx / l) * 12;
      p.vel[2] += (dz / l) * 12;
      p.vel[1] = 8;
    }
    if (d.contactCooldown > 0) d.contactCooldown--;
  }

  dying(d) {
    const game = this.game;
    d.deathTime++;
    d.pos[1] += 0.08;
    d.bodyYaw += 0.02;
    d.yaw = d.bodyYaw;
    // The dragon's 12,000 experience fountains out as it dies.
    if (d.deathTime % 10 === 0 && !this.state.killed) game.spawnXp?.([d.pos[0], d.pos[1], d.pos[2]], 600);
    if (d.deathTime % 4 === 0) {
      game.particles.burst([d.pos[0] + (Math.random() - 0.5) * 8, d.pos[1] + 2 + (Math.random() - 0.5) * 4, d.pos[2] + (Math.random() - 0.5) * 8], 'smoke', 8, 1.2);
      game.sound('explode_small', d.pos);
    }
    if (d.deathTime >= 200) {
      d.removed = true;
      this.state.killed = true;
      this.openPortal();
      const y = this.terrain.portalY + 4;
      game.world.setBlock(0, y, 0, B.DRAGON_EGG);
      game.hud.bossBar(null);
      game.onDragonKilled();
    }
  }

  openPortal() {
    const game = this.game;
    const world = game.worlds.end;
    const set = (x, y, z, id) => {
      world.ensureChunk(Math.floor(x / 16), Math.floor(z / 16));
      world.setBlock(x, y, z, id);
    };
    this.terrain.exitPortal(set, true);
  }
}
