// Rain, snow and thunderstorms on Minecraft's schedule: clear spells of half a
// day to a week of game time, showers of half a day to a day, and a separate
// thunder clock that only counts while it rains. Precipitation is drawn as
// columns of falling streaks around the camera that stop at the first block,
// so it never rains indoors.
import { B, SOLID, FLUID, LEAVES } from './blocks.js';
import { CHUNK, HEIGHT } from './constants.js';
import { BIOME } from './terrain.js';

const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

export const RADIUS = 10;
const FLOATS = 10; // per vertex: pos(3) uv(3) rgba(4)
export const MAX_WEATHER_QUADS = (RADIUS * 2 + 1) ** 2 + 64;

export class Weather {
  constructor(state) {
    this.state = {
      raining: false,
      thundering: false,
      rainTime: rand(12000, 180000),
      thunderTime: rand(12000, 180000),
      ...(state || {}),
    };
    this.rain = this.state.raining ? 1 : 0;
    this.thunder = this.state.raining && this.state.thundering ? 1 : 0;
    this.flash = 0;
    this.bolts = [];
    this.kindCache = new Map();
    this.topCache = new Map();
    this.data = new Float32Array(MAX_WEATHER_QUADS * 4 * FLOATS);
  }

  serialize() {
    return { ...this.state };
  }

  // /weather clear|rain|thunder [ticks]
  set(kind, ticks) {
    const s = this.state;
    s.raining = kind !== 'clear';
    s.thundering = kind === 'thunder';
    s.rainTime = ticks ?? (s.raining ? rand(12000, 24000) : rand(12000, 180000));
    s.thunderTime = s.thundering ? s.rainTime : rand(12000, 180000);
  }

  get raining() {
    return this.rain > 0.2;
  }

  get stormy() {
    return this.thunder > 0.9;
  }

  // What falls on this column: 'rain', 'snow' or null (deserts stay dry).
  kindAt(world, x, z) {
    if (world.dimension !== 'overworld') return null;
    const key = x * 65536 + z;
    let k = this.kindCache.get(key);
    if (k === undefined) {
      const info = world.terrain.columnInfo(x, z);
      if (info.biome === BIOME.DESERT) k = null;
      else if (info.biome === BIOME.TUNDRA || info.biome === BIOME.PEAKS || info.temperature < -0.28) k = 'snow';
      else k = 'rain';
      if (this.kindCache.size > 40000) this.kindCache.clear();
      this.kindCache.set(key, k);
    }
    return k;
  }

  // The highest block that stops rain in a column (-1 for none), cached until the chunk changes.
  topAt(world, x, z) {
    const chunk = world.getChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!chunk?.blocks) return HEIGHT;
    const key = x * 65536 + z;
    const hit = this.topCache.get(key);
    if (hit && hit.chunk === chunk && hit.version === chunk.version) return hit.y;
    let y = HEIGHT - 1;
    for (; y >= 0; y--) {
      const id = world.getBlock(x, y, z);
      if (SOLID[id] || FLUID[id] || LEAVES[id]) break;
    }
    if (this.topCache.size > 40000) this.topCache.clear();
    this.topCache.set(key, { y, chunk, version: chunk.version });
    return y;
  }

  // Is this spot out in the rain right now?
  wet(world, x, y, z) {
    if (!this.raining) return false;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    return this.kindAt(world, bx, bz) === 'rain' && this.topAt(world, bx, bz) < y;
  }

  tick(game) {
    const s = this.state;
    if (game.gamerules.doWeatherCycle !== false) {
      if (--s.rainTime <= 0) {
        s.raining = !s.raining;
        s.rainTime = s.raining ? rand(12000, 24000) : rand(12000, 180000);
      }
      if (--s.thunderTime <= 0) {
        s.thundering = !s.thundering;
        s.thunderTime = s.thundering ? rand(3600, 15600) : rand(12000, 180000);
      }
    }
    this.rain = approach(this.rain, s.raining ? 1 : 0, 0.01);
    this.thunder = approach(this.thunder, s.raining && s.thundering ? 1 : 0, 0.01);
    if (this.flash > 0) this.flash--;
    this.bolts = this.bolts.filter((b) => --b.ttl > 0);

    const world = game.world;
    if (world.dimension !== 'overworld' || this.rain <= 0) return;
    const p = game.player.pos;
    // Splashes where the rain lands, and the hiss of it.
    const splashes = Math.floor(this.rain * 5 + Math.random());
    let near = 0;
    for (let i = 0; i < splashes; i++) {
      const x = Math.floor(p[0] + (Math.random() - 0.5) * 20);
      const z = Math.floor(p[2] + (Math.random() - 0.5) * 20);
      if (this.kindAt(world, x, z) !== 'rain') continue;
      const top = this.topAt(world, x, z);
      if (top < 0 || Math.abs(top - p[1]) > 16) continue;
      near++;
      const lava = FLUID[world.getBlock(x, top, z)] === 2;
      game.particles.burst([x + Math.random(), top + 1.05, z + Math.random()], lava ? 'smoke' : 'splash', 1, 0.05);
    }
    if (near && game.tickCount % 8 === 0) game.sound('rain', null, 0.35 * this.rain * Math.min(1, near / 2));

    if (this.stormy && Math.random() < 1 / 450) {
      const x = Math.floor(p[0] + (Math.random() - 0.5) * 96);
      const z = Math.floor(p[2] + (Math.random() - 0.5) * 96);
      if (world.isLoaded(x, z) && this.kindAt(world, x, z)) this.strike(game, x, this.topAt(world, x, z) + 1, z);
    }
  }

  // A lightning bolt: a flash, a crack of thunder, fire where it lands and a
  // jolt for anything standing close.
  strike(game, x, y, z) {
    const world = game.world;
    const segments = [];
    let px = x + 0.5;
    let pz = z + 0.5;
    for (let h = y; h < y + 110; h += 4 + Math.random() * 6) {
      const nx = px + (Math.random() - 0.5) * 3;
      const nz = pz + (Math.random() - 0.5) * 3;
      segments.push([px, h, pz, nx, Math.min(y + 120, h + 8), nz]);
      px = nx;
      pz = nz;
    }
    this.bolts.push({ ttl: 8, segments });
    this.flash = 4;
    const p = game.player.pos;
    const dist = Math.hypot(x - p[0], z - p[2]);
    game.sound('thunder', null, Math.max(0.25, 1 - dist / 140));
    if (game.difficulty !== 'peaceful' && game.gamerules.doFireTick && world.getBlock(x, y, z) === B.AIR && SOLID[world.getBlock(x, y - 1, z)]) {
      world.setBlock(x, y, z, B.FIRE);
    }
    game.lightningStruck?.(x + 0.5, y, z + 0.5);
  }

  // Camera-centred rain and snow columns plus lightning bolts, as triangles for the renderer.
  geometry(game, cam, time, brightness, layers) {
    const world = game.world;
    if (world.dimension !== 'overworld') return null;
    const data = this.data;
    let o = 0;
    let quads = 0;
    const put = (x, y, z, u, v, layer, r, g, b, a) => {
      data[o++] = x; data[o++] = y; data[o++] = z;
      data[o++] = u; data[o++] = v; data[o++] = layer;
      data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a;
    };
    const level = this.rain;
    if (level > 0.01) {
      const cx = Math.floor(cam[0]);
      const cz = Math.floor(cam[2]);
      const top = cam[1] + RADIUS + 2;
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          const x = cx + dx;
          const z = cz + dz;
          const kind = this.kindAt(world, x, z);
          if (!kind) continue;
          const ground = Math.max(this.topAt(world, x, z) + 1, cam[1] - RADIUS);
          if (ground >= top) continue;
          const mx = x + 0.5 - cam[0];
          const mz = z + 0.5 - cam[2];
          const dist = Math.hypot(mx, mz);
          if (dist > RADIUS) continue;
          // A vertical quad through the column centre, turned to face the camera.
          const len = dist || 1;
          const sx = (-mz / len) * 0.5;
          const sz = (mx / len) * 0.5;
          const fade = (1 - (dist / RADIUS) ** 2) * level;
          const seed = ((x * 3129871) ^ (z * 116129781)) & 0xffff;
          const snow = kind === 'snow';
          const speed = snow ? 1.2 : 11;
          const scroll = time * speed + (seed % 97) * 0.37;
          const drift = snow ? Math.sin(time * 0.6 + seed) * 0.4 + time * 0.1 : (seed % 13) * 0.07;
          // Rain tiles four times across a column so streaks are a 64th of a block wide.
          const across = snow ? 2 : 4;
          const tall = snow ? 0.5 : 1;
          const v0 = (top + scroll) / tall;
          const v1 = (ground + scroll) / tall;
          const layer = snow ? layers.snow : layers.rain;
          const c = snow ? brightness : brightness * 0.95;
          const a = fade * (snow ? 0.95 : 0.7);
          const y0 = ground - cam[1];
          const y1 = top - cam[1];
          put(mx - sx, y0, mz - sz, drift, v1, layer, c, c, c, a);
          put(mx + sx, y0, mz + sz, drift + across, v1, layer, c, c, c, a);
          put(mx + sx, y1, mz + sz, drift + across, v0, layer, c, c, c, a);
          put(mx - sx, y1, mz - sz, drift, v0, layer, c, c, c, a);
          quads++;
        }
      }
    }
    // Lightning: thin bright crossed quads along the bolt.
    for (const bolt of this.bolts) {
      for (const [ax, ay, az, bx, by, bz] of bolt.segments) {
        if (quads >= MAX_WEATHER_QUADS - 2) break;
        for (const [ox, oz] of [[0.25, 0], [0, 0.25]]) {
          put(ax - ox - cam[0], ay - cam[1], az - oz - cam[2], 0, 1, layers.white, 1.6, 1.6, 2, 0.9);
          put(ax + ox - cam[0], ay - cam[1], az + oz - cam[2], 1, 1, layers.white, 1.6, 1.6, 2, 0.9);
          put(bx + ox - cam[0], by - cam[1], bz + oz - cam[2], 1, 0, layers.white, 1.6, 1.6, 2, 0.9);
          put(bx - ox - cam[0], by - cam[1], bz - oz - cam[2], 0, 0, layers.white, 1.6, 1.6, 2, 0.9);
          quads++;
        }
      }
    }
    return quads ? { data, quads } : null;
  }
}
