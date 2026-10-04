// Small camera-facing particles: block debris, smoke, flames, portal sparkles,
// hearts, crits and splashes.
import { SOLID, FACE_TEX } from './blocks.js';
import { textureIndex } from './textures.js';

const KINDS = {
  smoke: { tex: 'particle_smoke', color: [0.55, 0.55, 0.55], size: [0.08, 0.16], life: [0.6, 1.4], rise: 0.8, gravity: 0, uw: 1 },
  flame: { tex: 'particle_white', color: [1, 0.6, 0.15], size: [0.04, 0.07], life: [0.3, 0.6], rise: 0.6, gravity: 0, uw: 1 },
  portal: { tex: 'particle_white', color: [0.6, 0.3, 0.95], size: [0.03, 0.06], life: [0.6, 1.2], rise: 0.2, gravity: 0, uw: 1 },
  heart: { tex: 'particle_smoke', color: [1, 0.2, 0.3], size: [0.07, 0.09], life: [0.8, 1.2], rise: 0.6, gravity: 0, uw: 1 },
  crit: { tex: 'particle_white', color: [1, 0.95, 0.7], size: [0.03, 0.05], life: [0.3, 0.6], rise: 0, gravity: 10, uw: 1 },
  splash: { tex: 'particle_white', color: [0.6, 0.75, 1], size: [0.03, 0.05], life: [0.3, 0.6], rise: 2, gravity: 16, uw: 1 },
  explosion: { tex: 'particle_smoke', color: [0.85, 0.85, 0.85], size: [0.3, 0.6], life: [0.4, 0.9], rise: 0.3, gravity: 0, uw: 1 },
};

export class Particles {
  constructor() {
    this.list = [];
    this.layers = {};
    for (const k of Object.values(KINDS)) this.layers[k.tex] = textureIndex(k.tex);
    this.light = 1;
  }

  add(p) {
    this.list.push(p);
    if (this.list.length > 1000) this.list.splice(0, this.list.length - 1000);
  }

  burst(pos, kind, count = 1, spread = 0.2) {
    const k = KINDS[kind] ?? KINDS.smoke;
    for (let i = 0; i < count; i++) {
      const life = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
      const c = k.color;
      const shade = 0.85 + Math.random() * 0.3;
      this.add({
        pos: [pos[0] + (Math.random() - 0.5) * spread * 2, pos[1] + (Math.random() - 0.5) * spread * 2, pos[2] + (Math.random() - 0.5) * spread * 2],
        vel: [(Math.random() - 0.5) * spread * 2, k.rise + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * spread * 2],
        life,
        size: k.size[0] + Math.random() * (k.size[1] - k.size[0]),
        layer: this.layers[k.tex],
        u0: 0,
        v0: 0,
        uw: k.uw,
        color: [c[0] * shade, c[1] * shade, c[2] * shade],
        gravity: k.gravity,
        collide: kind === 'splash' || kind === 'crit',
      });
    }
  }

  blockBreak(x, y, z, id, light, count = 20) {
    const layer = FACE_TEX[id * 6];
    for (let i = 0; i < count; i++) {
      this.add({
        pos: [x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7],
        vel: [(Math.random() - 0.5) * 3.2, Math.random() * 3.5 + 0.5, (Math.random() - 0.5) * 3.2],
        life: 0.45 + Math.random() * 0.6,
        size: 0.045 + Math.random() * 0.045,
        layer,
        u0: Math.floor(Math.random() * 4) * 0.25,
        v0: Math.floor(Math.random() * 4) * 0.25,
        uw: 0.25,
        color: [light, light, light],
        gravity: 20,
        collide: true,
      });
    }
  }

  update(dt, world) {
    this.list = this.list.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vel[1] -= p.gravity * dt;
      const nx = p.pos[0] + p.vel[0] * dt;
      const ny = p.pos[1] + p.vel[1] * dt;
      const nz = p.pos[2] + p.vel[2] * dt;
      if (p.collide && SOLID[world.getBlock(Math.floor(nx), Math.floor(ny - p.size), Math.floor(nz))]) {
        p.vel[0] *= 0.5;
        p.vel[2] *= 0.5;
        p.vel[1] = 0;
        p.pos[0] = nx;
        p.pos[2] = nz;
      } else {
        p.pos[0] = nx;
        p.pos[1] = ny;
        p.pos[2] = nz;
      }
      if (!p.gravity) {
        p.vel[0] *= 0.96;
        p.vel[2] *= 0.96;
      }
      return true;
    });
  }
}
