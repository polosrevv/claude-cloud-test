// One play session: the dimensions, the player, entities, the 20 Hz game
// tick, and everything the player can do — mine, fight, build, eat, travel.
import {
  B, BLOCKS, SOLID, FLUID, FLUID_LEVEL, PLANT, COLLISION, FACING_DIR,
  canSupportPlant, isReplaceable, facingBlock, facingTowardViewer, facingOfLook, fluidBlock,
} from './blocks.js';
import { ITEMS, itemForBlock } from './items.js';
import { CHUNK, HEIGHT, TPS } from './constants.js';
import { World, posKey } from './world.js';
import { END_SPAWN } from './end.js';
import { Player } from './player.js';
import { PlayerInventory, newFurnace, tickFurnace } from './inventory.js';
import { EntityManager, itemEntity, projectile, primedTnt, serializeEntity, deserializeEntity } from './entities.js';
import { MOBS, hurtMob } from './mobs.js';
import { spawnTick, spawnerTick, populateChunk } from './spawning.js';
import { BlockUpdater } from './blockupdates.js';
import { DragonFight } from './dragon.js';
import { tryLightPortal, arriveThroughPortal, checkEndPortal } from './portals.js';
import { breakSeconds, dropsFor, toolOf } from './drops.js';
import { raycast } from './raycast.js';
import { skyAt } from './sky.js';
import { Particles } from './particles.js';
import { forBlocksIn } from './physics.js';
import { Advancements } from './advancements.js';
import { playBlockSound, playSound } from './audio.js';

const DAY_TICKS = 24000;
const TICK = 1 / TPS;
const DIM_STYLE = {
  overworld: { sky: 'overworld', ambient: [0.045, 0.045, 0.045], fogColor: null },
  nether: { sky: 'none', ambient: [0.3, 0.2, 0.17], fogColor: [0.22, 0.05, 0.04], fogNear: 0.1, fogFar: 0.8 },
  end: { sky: 'end', ambient: [0.34, 0.3, 0.4], fogColor: [0.05, 0.03, 0.07], fogNear: 0.45, fogFar: 1 },
};
const DEATH_MESSAGES = {
  mob: (s) => `was slain by ${s}`,
  arrow: (s) => `was shot by ${s}`,
  explosion: (s) => (s ? `was blown up by ${s}` : 'blew up'),
  fall: () => 'fell from a high place',
  lava: () => 'tried to swim in lava',
  fire: () => 'burned to death',
  drown: () => 'drowned',
  starve: () => 'starved to death',
  cactus: () => 'was pricked to death',
  void: () => 'fell out of the world',
  dragon: () => 'was slain by Ender Dragon',
  fireball: (s) => `was fireballed by ${s}`,
  pearl: () => 'fell after teleporting',
  command: () => 'died',
};

const sameDir = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export class Game {
  constructor(renderer, streamer, textures) {
    this.renderer = renderer;
    this.streamer = streamer;
    this.textures = textures;
    this.hud = null;
    this.particles = new Particles();
    this.updater = new BlockUpdater(this);
    this.player = new Player();
    this.inventory = new PlayerInventory();
    this.selected = 0;
    this.state = 'title';
    this.clock = 0;
    this.accumulator = 0;
    this.held = { 0: false, 2: false };
    this.mining = null;
    this.using = null;
    this.swing = 1;
    this.nextUse = 0;
  }

  // ---------------------------------------------------------------- session

  // meta: { id, name, seed, seedText, mode, cheats, difficulty }; save: stored data or null.
  open(meta, save) {
    this.meta = meta;
    this.seed = meta.seed;
    this.seedText = meta.seedText;
    this.cheats = meta.cheats !== false;
    this.worlds = {};
    this.tickCount = save?.tickCount ?? 0;
    this.dayTicks = save?.dayTicks ?? 0;
    this.difficulty = save?.difficulty ?? meta.difficulty ?? 'normal';
    this.gamerules = { keepInventory: false, doDaylightCycle: true, doMobSpawning: true, mobGriefing: true, doFireTick: true, naturalRegeneration: true, ...(save?.gamerules || {}) };
    this.stats = { playTicks: 0, mobsKilled: 0, blocksMined: 0, blocksPlaced: 0, deaths: 0, ...(save?.stats || {}) };
    this.dragonState = save?.dragon ?? { killed: false, started: false };
    this.advancements = new Advancements(save?.advancements, (a) => this.onAdvancement(a));
    this.savedDims = save?.dims ?? {};
    const p = this.player;
    p.resetStats();
    p.mode = save?.player?.mode ?? meta.mode ?? 'survival';
    this.inventory = new PlayerInventory();
    if (save?.inventory) this.inventory.load(save.inventory);
    else if (p.mode === 'creative') this.giveCreativeKit();
    this.selected = save?.player?.selected ?? 0;
    const dim = save?.player?.dim ?? 'overworld';
    this.world = this.loadWorld(dim);
    this.worldSpawn = save?.worldSpawn ?? null;
    this.spawn = save?.player?.spawn ?? null;
    if (save?.player) {
      const sp = save.player;
      p.teleport(...sp.pos);
      p.yaw = sp.yaw ?? 0;
      p.pitch = sp.pitch ?? 0;
      p.flying = !!sp.flying;
      for (const k of ['health', 'food', 'saturation', 'exhaustion', 'air', 'fireTicks']) if (typeof sp[k] === 'number') p[k] = sp[k];
      this.placeOnArrival = 'saved';
    } else {
      const s = this.world.terrain.findSpawn();
      this.worldSpawn = s;
      p.teleport(s.x, s.y, s.z);
      p.yaw = Math.PI * 0.75;
      p.pitch = -0.1;
      this.placeOnArrival = 'surface';
    }
    this.worldSpawn ??= this.worlds.overworld?.terrain.findSpawn() ?? { x: 0.5, y: 80, z: 0.5 };
    this.dragonFight = new DragonFight(this, this.dragonState);
    this.streamer.setWorld(this.world);
    this.playerReady = false;
    this.mining = null;
    this.using = null;
    this.particles.list = [];
    this.renderer.itemMeshes.clear();
    this.hud?.refreshHotbar();
  }

  loadWorld(dim) {
    if (this.worlds[dim]) return this.worlds[dim];
    const w = new World(this.seed, dim);
    const saved = this.savedDims[dim];
    if (saved) w.load(saved);
    w.entities = new EntityManager(this);
    for (const s of saved?.entities || []) {
      const e = deserializeEntity(s);
      if (e) w.entities.add(e);
    }
    w.onChange = (x, y, z, old, id) => this.updater.changed(w, x, y, z, old, id);
    w.onChunkLoad = (chunk) => this.onChunkLoad(w, chunk);
    w.onChunkUnload = (chunk) => this.onChunkUnload(w, chunk);
    this.worlds[dim] = w;
    return w;
  }

  get entities() {
    return this.world.entities;
  }

  onChunkLoad(world, chunk) {
    const parked = world.parked.get(chunk.key);
    if (parked) {
      world.parked.delete(chunk.key);
      for (const s of parked) {
        const e = deserializeEntity(s);
        if (e) world.entities.add(e);
      }
    }
    populateChunk(this, world, chunk);
  }

  onChunkUnload(world, chunk) {
    const x0 = chunk.cx * CHUNK;
    const z0 = chunk.cz * CHUNK;
    const keep = [];
    for (const e of world.entities.list) {
      if (e.removed || e.kind === 'projectile' || e.type === 'dragon') continue;
      if (e.pos[0] < x0 || e.pos[0] >= x0 + CHUNK || e.pos[2] < z0 || e.pos[2] >= z0 + CHUNK) continue;
      const s = serializeEntity(e);
      e.removed = true;
      if (s) keep.push(s);
    }
    if (keep.length) world.parked.set(chunk.key, [...(world.parked.get(chunk.key) || []), ...keep]);
  }

  serialize() {
    const p = this.player;
    const dims = {};
    for (const [dim, w] of Object.entries(this.worlds)) {
      dims[dim] = { ...w.serialize(), entities: w.entities.serialize() };
    }
    for (const [dim, data] of Object.entries(this.savedDims)) if (!dims[dim]) dims[dim] = data;
    return {
      version: 2,
      tickCount: this.tickCount,
      dayTicks: this.dayTicks,
      difficulty: this.difficulty,
      gamerules: this.gamerules,
      stats: this.stats,
      dragon: this.dragonState,
      advancements: this.advancements.serialize(),
      worldSpawn: this.worldSpawn,
      inventory: this.inventory.serialize(),
      player: {
        dim: this.world.dimension,
        mode: p.mode,
        pos: p.pos.map((v) => Math.round(v * 1000) / 1000),
        yaw: p.yaw,
        pitch: p.pitch,
        flying: p.flying,
        health: p.dead ? 20 : p.health,
        food: p.food,
        saturation: p.saturation,
        exhaustion: p.exhaustion,
        air: p.air,
        fireTicks: p.fireTicks,
        spawn: this.spawn,
        selected: this.selected,
      },
      dims,
    };
  }

  giveCreativeKit() {
    const kit = ['grass', 'dirt', 'stone', 'cobblestone', 'planks', 'oak_log', 'glass', 'bricks', 'glowstone'];
    kit.forEach((item, i) => { this.inventory.main.slots[i] = { item, count: 64, damage: 0 }; });
  }

  // ---------------------------------------------------------------- frame

  frame(dt, input) {
    this.clock += dt;
    const p = this.player;
    if (this.state === 'playing' || this.state === 'screen' || this.state === 'dead' || this.state === 'sleeping') {
      if (!this.playerReady) {
        if (!this.tryPlacePlayer()) {
          this.hud?.loading(this.streamer.progress(p.pos[0], p.pos[2], 1));
          return;
        }
        this.playerReady = true;
        this.hud?.loading(null);
      }
      const move = this.state === 'playing' && !p.dead ? input : { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
      if (!p.dead && this.state !== 'sleeping') {
        const ev = p.update(dt, move, this.world);
        if (ev.enteredWater) {
          this.sound('splash', p.pos);
          this.particles.burst([p.pos[0], p.pos[1] + 0.5, p.pos[2]], 'splash', 10, 0.5);
        }
        if (ev.fallDamage > 0) this.damagePlayer(ev.fallDamage, 'fall');
        this.footsteps();
      }
      this.accumulator = Math.min(this.accumulator + dt, 0.25);
      while (this.accumulator >= TICK) {
        this.accumulator -= TICK;
        this.tick();
      }
      if (this.state === 'playing' && !p.dead) this.updateInteraction(dt);
    }
    this.particles.update(dt, this.world);
    this.swing = Math.min(1, this.swing + dt * 3.6);
  }

  tryPlacePlayer() {
    const p = this.player;
    if (this.streamer.progress(p.pos[0], p.pos[2], 1) < 1) return false;
    const x = Math.floor(p.pos[0]);
    const z = Math.floor(p.pos[2]);
    if (this.placeOnArrival === 'surface') {
      const top = this.world.surfaceY(x, z);
      p.teleport(p.pos[0], top + 1, p.pos[2]);
      if (this.world.dimension === 'overworld' && !this.spawnFixed) {
        this.worldSpawn = { x: p.pos[0], y: top + 1, z: p.pos[2] };
        this.spawnFixed = true;
      }
    } else {
      let guard = 0;
      while (guard++ < HEIGHT && (SOLID[this.world.getBlock(x, Math.floor(p.pos[1]), z)] || SOLID[this.world.getBlock(x, Math.floor(p.pos[1] + 1), z)])) {
        p.pos[1] = Math.floor(p.pos[1]) + 1;
      }
    }
    this.placeOnArrival = null;
    return true;
  }

  footsteps() {
    const p = this.player;
    this.lastStep ??= p.walkDist;
    if (p.onGround && p.walkDist - this.lastStep > 1.8) {
      this.lastStep = p.walkDist;
      const below = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] - 0.1), Math.floor(p.pos[2]));
      if (below) playBlockSound(BLOCKS[below].sound, 'step');
    }
  }

  // ---------------------------------------------------------------- tick

  tick() {
    this.tickCount++;
    this.stats.playTicks++;
    if (this.gamerules.doDaylightCycle && this.world.dimension === 'overworld') this.dayTicks++;
    const world = this.world;
    this.updater.process();
    this.updater.runScheduled();
    if (this.tickCount % 2 === 0) this.updater.randomTicks();
    this.entities.tick();
    if (this.tickCount % 20 === 0) spawnTick(this);
    if (this.tickCount % 2 === 0) spawnerTick(this);
    this.tickFurnaces(world);
    if (world.dimension === 'end') this.dragonFight.tick();
    else this.hud?.bossBar(null);
    const p = this.player;
    if (!p.dead) {
      this.tickPlayer();
      this.checkPortals();
    }
    if (this.state === 'sleeping') this.tickSleep();
    if (this.tickCount % 20 === 0) {
      this.advancements.check(this.inventory);
      if (world.dimension === 'nether' && world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] - 0.5), Math.floor(p.pos[2])) === B.NETHER_BRICKS) this.advancements.event('fortress');
      if (world.dimension === 'overworld' && world.terrain.strongholds) {
        for (const s of world.terrain.strongholds()) {
          if (Math.abs(p.pos[0] - s.centre[0]) < 8 && Math.abs(p.pos[2] - s.centre[2]) < 10 && Math.abs(p.pos[1] - s.centre[1]) < 6) this.advancements.event('stronghold');
        }
      }
    }
  }

  tickFurnaces(world) {
    for (const [key, be] of world.blockEntities) {
      if (be.type !== 'furnace') continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!world.isLoaded(x, z)) continue;
      if (tickFurnace(be)) {
        const id = world.getBlock(x, y, z);
        const def = BLOCKS[id];
        if (def.entity !== 'furnace') continue;
        const lit = be.burn > 0;
        world.setBlock(x, y, z, B[`FURNACE${lit ? '_LIT' : ''}_${'NESW'[def.facing]}`]);
        world.blockEntities.set(key, be);
      }
      if (this.openContainer?.data === be) this.hud?.refreshScreen();
    }
  }

  tickPlayer() {
    const p = this.player;
    const world = this.world;
    if (p.hurtTicks > 0) p.hurtTicks--;
    if (p.invulnerable > 0) p.invulnerable--;
    if (p.portalCooldown > 0) p.portalCooldown--;
    if (!p.vulnerable) {
      p.fireTicks = 0;
      p.air = 300;
      return;
    }
    const b = p.box();
    let lava = false;
    let fire = false;
    let cactus = false;
    forBlocksIn(world, b[0], b[1], b[2], b[3], b[4], b[5], (id) => {
      if (FLUID[id] === 2) lava = true;
      if (id === B.FIRE) fire = true;
      return false;
    });
    forBlocksIn(world, b[0] - 0.02, b[1], b[2] - 0.02, b[3] + 0.02, b[4], b[5] + 0.02, (id) => {
      if (id === B.CACTUS) cactus = true;
      return false;
    });
    if (lava) {
      p.fireTicks = Math.max(p.fireTicks, 300);
      this.damagePlayer(4, 'lava');
    }
    if (fire) {
      p.fireTicks = Math.max(p.fireTicks, 160);
      this.damagePlayer(1, 'fire');
    }
    if (cactus) this.damagePlayer(1, 'cactus');
    if (p.inWater) p.fireTicks = 0;
    if (p.fireTicks > 0) {
      p.fireTicks--;
      if (p.fireTicks % 20 === 0) this.damagePlayer(1, 'fire');
    }
    // Breath underwater.
    if (p.headInWater) {
      p.air--;
      if (p.air <= -20) {
        p.air = 0;
        this.damagePlayer(2, 'drown');
      }
    } else {
      p.air = Math.min(300, p.air + 5);
    }
    if (p.pos[1] < -64 && this.tickCount % 10 === 0) this.damagePlayer(4, 'void', null, true);

    // Hunger.
    if (this.difficulty === 'peaceful') {
      if (p.food < 20 && this.tickCount % 20 === 0) p.food++;
      if (p.health < 20 && this.tickCount % 20 === 0) p.health = Math.min(20, p.health + 1);
    }
    while (p.exhaustion >= 4) {
      p.exhaustion -= 4;
      if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
      else if (this.difficulty !== 'peaceful') p.food = Math.max(0, p.food - 1);
    }
    if (p.regenEffect > 0) {
      p.regenEffect--;
      if (p.regenEffect % 10 === 0) p.health = Math.min(20, p.health + 1);
    }
    if (this.gamerules.naturalRegeneration && p.food >= 18 && p.health < 20) {
      p.regenTimer++;
      const fast = p.food >= 20 && p.saturation > 0;
      if (p.regenTimer >= (fast ? 10 : 80)) {
        p.regenTimer = 0;
        p.health = Math.min(20, p.health + 1);
        p.exhaustion += fast ? Math.min(p.saturation, 6) : 6;
      }
    } else if (p.food <= 0) {
      p.starveTimer++;
      if (p.starveTimer >= 80) {
        p.starveTimer = 0;
        const floor = { easy: 10, normal: 1, hard: 0 }[this.difficulty] ?? 1;
        if (p.health > floor) this.damagePlayer(1, 'starve', null, true);
      }
    } else {
      p.regenTimer = 0;
      p.starveTimer = 0;
    }
  }

  // ---------------------------------------------------------------- damage

  armorPoints() {
    return this.inventory.armorPoints();
  }

  // amount in half-hearts. bypass: ignores armour and invulnerability frames.
  damagePlayer(amount, cause, source = null, bypass = false) {
    const p = this.player;
    if (!p.vulnerable || p.dead || amount <= 0) return false;
    let dmg = amount;
    const armoured = ['mob', 'arrow', 'explosion', 'cactus', 'lava', 'fireball', 'dragon'].includes(cause);
    if (armoured) {
      const points = this.armorPoints();
      dmg *= 1 - Math.min(20, points) / 25;
      if (points > 0) this.wearArmor(amount);
    }
    if (!bypass) {
      if (p.invulnerable > 0) {
        if (dmg <= p.lastDamage) return false;
        const extra = dmg - p.lastDamage;
        p.lastDamage = dmg;
        dmg = extra;
      } else {
        p.invulnerable = 10;
        p.lastDamage = dmg;
      }
    }
    p.health -= dmg;
    p.hurtTicks = 10;
    p.exhaustion += 0.1;
    this.sound('hurt', p.pos, 0.9);
    if (source && source.pos) {
      const dx = p.pos[0] - source.pos[0];
      const dz = p.pos[2] - source.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      p.vel[0] += (dx / len) * 6;
      p.vel[2] += (dz / len) * 6;
      if (p.onGround) p.vel[1] = Math.max(p.vel[1], 5);
      this.hurtYaw = Math.atan2(-dx, -dz) - p.yaw;
    } else {
      this.hurtYaw = 0;
    }
    this.lastCause = { cause, source };
    if (p.health <= 0) this.killPlayer(cause, source);
    return true;
  }

  wearArmor(amount) {
    const per = Math.max(1, Math.floor(amount / 4));
    const slots = this.inventory.armor.slots;
    slots.forEach((s, i) => {
      if (!s) return;
      s.damage = (s.damage || 0) + per;
      if (s.damage >= ITEMS[s.item].durability) {
        slots[i] = null;
        this.sound('break_tool', this.player.pos);
      }
    });
  }

  killPlayer(cause, source = null) {
    const p = this.player;
    if (p.dead) return;
    if (cause === 'command' && !p.vulnerable) {
      p.mode = 'survival';
    }
    p.health = 0;
    p.dead = true;
    this.stats.deaths++;
    const who = source?.def?.name ?? (source ? 'something' : '');
    const msg = `You ${(DEATH_MESSAGES[cause] ?? (() => 'died'))(who)}`;
    if (!this.gamerules.keepInventory) {
      const all = [...this.inventory.main.slots, ...this.inventory.armor.slots, ...this.inventory.craft.slots, this.inventory.cursor];
      const stacks = all.filter(Boolean);
      this.inventory.main.clear();
      this.inventory.armor.clear();
      this.inventory.craft.clear();
      this.inventory.cursor = null;
      for (const s of stacks) {
        const v = [(Math.random() - 0.5) * 6, 3 + Math.random() * 2, (Math.random() - 0.5) * 6];
        this.entities.add(itemEntity(s, p.pos[0], p.pos[1] + 1, p.pos[2], v, 40));
      }
    }
    this.mining = null;
    this.using = null;
    this.held = { 0: false, 2: false };
    this.state = 'dead';
    this.hud?.refreshHotbar();
    this.hud?.showDeath(msg);
    this.hud?.chat([{ text: msg, kind: 'death' }]);
  }

  respawn() {
    const p = this.player;
    p.resetStats();
    p.vel = [0, 0, 0];
    p.flying = false;
    let target = null;
    if (this.spawn) {
      const w = this.loadWorld(this.spawn.dim ?? 'overworld');
      const [x, y, z] = this.spawn.pos.map(Math.floor);
      w.ensureChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
      if (BLOCKS[w.getBlock(x, y, z)].bed) target = { dim: w.dimension, pos: [x + 0.5, y + 0.6, z + 0.5] };
      else {
        this.spawn = null;
        this.hud?.toast('Your home bed was missing or obstructed');
      }
    }
    if (!target) target = { dim: 'overworld', pos: [this.worldSpawn.x, this.worldSpawn.y, this.worldSpawn.z] };
    this.switchWorld(target.dim);
    p.teleport(...target.pos);
    this.placeOnArrival = this.spawn ? 'saved' : 'surface';
    this.playerReady = false;
    this.state = 'playing';
    this.hud?.refreshHotbar();
  }

  // ---------------------------------------------------------------- world helpers

  switchWorld(dim) {
    if (this.world.dimension === dim) return;
    this.world = this.loadWorld(dim);
    this.streamer.setWorld(this.world);
    this.particles.list = [];
    this.mining = null;
  }

  sunlight() {
    if (this.world.dimension !== 'overworld') return 0;
    return skyAt(this.timeOfDay).daylight;
  }

  get timeOfDay() {
    return (this.dayTicks % DAY_TICKS) / DAY_TICKS;
  }

  isDay() {
    const t = this.timeOfDay;
    return this.world.dimension === 'overworld' && t > 0.02 && t < 0.48;
  }

  // Effective light level 0-15 at a block, accounting for night.
  lightAt(x, y, z) {
    const l = this.world.getLight(x, y, z);
    let sky = l >> 4;
    if (this.world.dimension === 'overworld') sky = Math.max(0, sky - Math.round((1 - this.sunlight()) * 11.5));
    return Math.max(sky, l & 15);
  }

  // Brightness multiplier (rgb) for an entity standing at (x, y, z).
  lightColor(x, y, z) {
    const l = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    const sky = this.skyState ?? skyAt(this.timeOfDay);
    const daylight = this.world.dimension === 'overworld' ? sky.daylight : 0;
    const s = Math.pow(0.85, 15 - (l >> 4)) * daylight;
    const b = (l & 15) ? Math.pow(0.85, 15 - (l & 15)) * 1.08 : 0;
    const amb = DIM_STYLE[this.world.dimension].ambient;
    return [Math.max(s * sky.skyTint[0], b, amb[0]), Math.max(s * sky.skyTint[1], b * 0.86, amb[1]), Math.max(s * sky.skyTint[2], b * 0.66, amb[2])];
  }

  setTime(ticks) {
    this.dayTicks = Math.max(0, Math.floor(ticks));
  }

  setGameMode(mode) {
    const p = this.player;
    p.mode = mode;
    if (mode !== 'survival') {
      p.fireTicks = 0;
      p.health = Math.max(p.health, 1);
    }
    if (mode === 'survival') p.flying = false;
    if (mode === 'spectator') p.flying = true;
    this.hud?.refreshHotbar();
  }

  teleportPlayer(x, y, z) {
    this.player.teleport(x, y, z);
    this.playerReady = false;
    this.placeOnArrival = 'saved';
  }

  setSpawn(pos, dim) {
    this.spawn = { dim, pos: [...pos] };
  }

  heldStack() {
    return this.inventory.main.slots[this.selected];
  }

  heldItem() {
    return this.heldStack()?.item ?? null;
  }

  sound(name, pos, volume = 1) {
    const p = this.player.pos;
    const d = pos ? Math.hypot(pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]) : 0;
    const v = volume * Math.max(0, 1 - d / 24);
    if (v > 0.02) playSound(name, v);
  }

  // ---------------------------------------------------------------- items & drops

  dropStacks(pos, stacks) {
    for (const s of stacks) {
      if (!s || s.count <= 0) continue;
      this.entities.add(itemEntity(s, pos[0], pos[1], pos[2]));
    }
  }

  // Throw an item from the player's hand (Q).
  dropFromHand(all) {
    const s = this.heldStack();
    if (!s) return;
    const n = all ? s.count : 1;
    this.throwStack({ item: s.item, count: n, damage: s.damage });
    s.count -= n;
    if (s.count <= 0) this.inventory.main.slots[this.selected] = null;
    this.hud?.refreshHotbar();
  }

  throwStack(stack) {
    const p = this.player;
    const look = p.look;
    const eye = p.eye;
    this.entities.add(itemEntity(stack, eye[0], eye[1] - 0.3, eye[2], [look[0] * 6, look[1] * 6 + 1, look[2] * 6], 40));
  }

  // Use up one of the held item (survival only).
  consumeHeld(n = 1) {
    if (!this.player.vulnerable) return;
    const s = this.heldStack();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.inventory.main.slots[this.selected] = null;
    this.hud?.refreshHotbar();
  }

  // Wear down the held tool; it breaks at its durability.
  damageHeld(amount = 1) {
    if (!this.player.vulnerable) return;
    const s = this.heldStack();
    if (!s) return;
    const max = ITEMS[s.item].durability;
    if (!max) return;
    s.damage = (s.damage || 0) + amount;
    if (s.damage >= max) {
      this.inventory.main.slots[this.selected] = null;
      this.sound('break_tool', this.player.pos);
      this.hud?.toast(`Your ${ITEMS[s.item].name} broke`);
    }
    this.hud?.refreshHotbar();
  }

  replaceHeld(stack) {
    const s = this.heldStack();
    if (s && s.count > 1) {
      s.count--;
      const left = this.inventory.give(stack);
      if (left) this.throwStack({ ...stack, count: left });
    } else {
      this.inventory.main.slots[this.selected] = stack;
    }
    this.hud?.refreshHotbar();
  }

  // Break a block with no player involved (lost support, washed away, explosion).
  breakNaturally(x, y, z, withDrops = true) {
    const world = this.world;
    const id = world.getBlock(x, y, z);
    if (id === B.AIR || FLUID[id]) return;
    const def = BLOCKS[id];
    world.setBlock(x, y, z, B.AIR);
    if (!withDrops || def.door?.half === 'upper' || def.bed === 'head' || id === B.FIRE) return;
    const stacks = dropsFor(id, null);
    this.dropStacks([x + 0.5, y + 0.4, z + 0.5], stacks);
  }

  dropContainer(x, y, z) {
    const be = this.world.blockEntities.get(posKey(x, y, z));
    if (be?.slots) this.dropStacks([x + 0.5, y + 0.5, z + 0.5], be.slots.filter(Boolean));
  }

  // ---------------------------------------------------------------- interaction

  updateTarget() {
    const p = this.player;
    if (p.spectator) { this.target = null; return; }
    const eye = p.eye;
    const look = p.look;
    const reach = p.creative ? 5 : 4.5;
    const block = raycast(this.world, eye, look, reach);
    const ent = this.entities.raycast(eye, look, p.creative ? 5 : 3.5, (e) => (e.kind === 'mob' && e.deathTime === 0) || e.kind === 'crystal');
    if (ent && (!block || ent.distance < block.distance)) this.target = { entity: ent.entity, distance: ent.distance };
    else this.target = block;
  }

  updateInteraction(dt) {
    this.updateTarget();
    this.updateMining(dt);
    if (this.using) this.updateUsing(dt);
    else if (this.held[2] && this.clock >= this.nextUse) {
      this.use(true);
      this.nextUse = this.clock + 0.2;
    }
  }

  onAction(button, down) {
    if (this.state !== 'playing' || this.player.dead) return;
    if (button === 1) {
      if (down) this.pickBlock();
      return;
    }
    if (button !== 0 && button !== 2) return;
    this.held[button] = down;
    if (button === 0 && down) {
      this.updateTarget();
      if (this.target?.entity) this.attack(this.target.entity);
      else if (!this.target) this.swing = 0;
    }
    if (button === 2) {
      if (down) {
        this.use(false);
        this.nextUse = this.clock + 0.25;
      } else if (this.using) {
        this.finishUsing(true);
      }
    }
  }

  updateMining(dt) {
    const p = this.player;
    const t = this.target;
    if (!this.held[0] || !t || t.entity || p.spectator) {
      this.mining = null;
      return;
    }
    if (p.creative) {
      if (!this.mining || this.clock >= this.mining.next) {
        this.breakByPlayer(t);
        this.mining = { next: this.clock + 0.25 };
      }
      return;
    }
    const m = this.mining;
    if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z || m.id !== t.id) {
      this.mining = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0, sound: 0, cooldown: m?.cooldown ?? 0 };
      return;
    }
    if (m.cooldown > 0) { m.cooldown -= dt; return; }
    const secs = breakSeconds(t.id, this.heldItem(), { inWater: p.headInWater, onGround: p.onGround || p.onLadder });
    if (secs === Infinity) return;
    m.progress += secs <= 0 ? 1 : dt / secs;
    if (this.swing >= 1) this.swing = 0;
    m.sound -= dt;
    if (m.sound <= 0) {
      m.sound = 0.25;
      playBlockSound(BLOCKS[t.id].sound, 'step');
    }
    if (m.progress >= 1) {
      this.breakByPlayer(t);
      this.mining = { cooldown: 0.25 };
    }
  }

  breakByPlayer(t) {
    const world = this.world;
    const p = this.player;
    const { x, y, z } = t;
    const id = world.getBlock(x, y, z);
    const def = BLOCKS[id];
    if (id === B.AIR || FLUID[id]) return;
    if (def.hardness < 0 && !p.creative) return;
    if (y === 0 && id === B.BEDROCK) return;
    const held = this.heldItem();
    const light = this.lightColor(x + 0.5, y + 0.5, z + 0.5)[0];
    this.particles.blockBreak(x, y, z, id, Math.max(0.3, light));
    playBlockSound(def.sound, 'break');
    this.swing = 0;
    if (def.entity === 'chest' || def.entity === 'furnace') this.dropContainer(x, y, z);
    // Doors and beds take their other half with them.
    if (def.door) {
      const other = def.door.half === 'lower' ? y + 1 : y - 1;
      if (BLOCKS[world.getBlock(x, other, z)].door) world.setBlock(x, other, z, B.AIR);
    }
    if (def.bed) {
      const [dx, dz] = FACING_DIR[def.facing];
      const s = def.bed === 'foot' ? 1 : -1;
      if (BLOCKS[world.getBlock(x + dx * s, y, z + dz * s)].bed) world.setBlock(x + dx * s, y, z + dz * s, B.AIR);
    }
    world.setBlock(x, y, z, B.AIR);
    this.stats.blocksMined++;
    if (p.vulnerable) {
      this.dropStacks([x + 0.5, y + 0.4, z + 0.5], dropsFor(id, held));
      if (def.hardness > 0 && toolOf(held)) this.damageHeld(toolOf(held).type === 'sword' ? 2 : 1);
      p.exhaustion += 0.005;
      // Ice left behind melts into water when there is something under it.
      if (id === B.ICE && world.getBlock(x, y - 1, z) !== B.AIR) world.setBlock(x, y, z, B.WATER);
    }
  }

  attack(e) {
    const p = this.player;
    this.swing = 0;
    if (p.spectator) return;
    if (e.kind === 'crystal') {
      this.dragonFight.crystalDestroyed(e);
      return;
    }
    if (e.kind !== 'mob') return;
    const tool = toolOf(this.heldItem());
    let dmg = tool?.damage ?? 1;
    const crit = p.vel[1] < -0.5 && !p.onGround && !p.inWater && !p.onLadder;
    if (crit) {
      dmg *= 1.5;
      this.particles.burst([e.pos[0], e.pos[1] + e.h * 0.7, e.pos[2]], 'crit', 8, 0.4);
    }
    const dir = [e.pos[0] - p.pos[0], 0, e.pos[2] - p.pos[2]];
    const hit = hurtMob(e, dmg, this, { kind: 'player', entity: 'player', dir, knockback: p.sprinting ? 1.6 : 1 });
    if (hit) {
      if (p.sprinting) p.sprinting = false;
      p.exhaustion += 0.1;
      if (tool) this.damageHeld(tool.type === 'sword' ? 1 : 2);
    }
  }

  pickBlock() {
    const t = this.target;
    if (!t || t.entity) return;
    const item = itemForBlock(t.id);
    if (!item) return;
    const slots = this.inventory.main.slots;
    const at = slots.findIndex((s, i) => i < 9 && s?.item === item);
    if (at >= 0) {
      this.selectSlot(at);
      return;
    }
    if (this.player.creative) {
      slots[this.selected] = { item, count: ITEMS[item].maxStack, damage: 0 };
      this.hud?.refreshHotbar();
    } else {
      const inv = slots.findIndex((s, i) => i >= 9 && s?.item === item);
      if (inv >= 0) {
        [slots[inv], slots[this.selected]] = [slots[this.selected], slots[inv]];
        this.hud?.refreshHotbar();
      }
    }
  }

  selectSlot(i) {
    if (this.using) this.finishUsing(false);
    this.selected = i;
    this.mining = null;
    this.hud?.refreshHotbar(true);
  }

  // Right click. `repeat` is true while the button is held (placing rows of blocks).
  use(repeat) {
    const p = this.player;
    if (p.spectator) return;
    this.updateTarget();
    const t = this.target;
    const held = this.heldStack();
    const item = held ? ITEMS[held.item] : null;
    if (t?.entity) {
      if (!repeat) this.interactEntity(t.entity, held);
      return;
    }
    if (t && !p.sneaking && !repeat && this.useBlock(t, held)) {
      this.swing = 0;
      return;
    }
    if (!item) return;
    if (item.food) {
      if (p.food < 20 || item.food.always || !p.vulnerable) this.using = { kind: 'eat', time: 0, item: item.key };
      return;
    }
    if (item.use === 'bow') {
      if (!repeat && (!p.vulnerable || this.inventory.main.count('arrow') > 0)) this.using = { kind: 'bow', time: 0 };
      return;
    }
    if (repeat && !(item.block || item.use === 'plant' || item.flatBlock)) return;
    if (this.useItem(item, held, t)) this.swing = 0;
  }

  useBlock(t, held) {
    const world = this.world;
    const def = BLOCKS[t.id];
    const key = posKey(t.x, t.y, t.z);
    switch (def.use) {
      case 'crafting':
        this.openScreen('crafting', null);
        return true;
      case 'furnace': {
        let be = world.blockEntities.get(key);
        if (!be) world.blockEntities.set(key, (be = newFurnace()));
        this.openScreen('furnace', be);
        return true;
      }
      case 'chest': {
        let be = world.blockEntities.get(key);
        if (!be) world.blockEntities.set(key, (be = { type: 'chest', slots: new Array(27).fill(null) }));
        this.openScreen('chest', be);
        return true;
      }
      case 'bed':
        this.trySleep(t);
        return true;
      case 'door': {
        const lowerY = def.door.half === 'lower' ? t.y : t.y - 1;
        for (const yy of [lowerY, lowerY + 1]) {
          const d = BLOCKS[world.getBlock(t.x, yy, t.z)];
          if (!d.door) continue;
          world.setBlock(t.x, yy, t.z, B[`OAK_DOOR_${d.door.half}_${'nesw'[d.facing]}${d.door.open ? '' : '_open'}`.toUpperCase()]);
        }
        this.sound('door', [t.x, t.y, t.z]);
        return true;
      }
      case 'tnt':
        if (held?.item === 'flint_and_steel') {
          world.setBlock(t.x, t.y, t.z, B.AIR);
          this.entities.add(primedTnt(t.x, t.y, t.z));
          this.sound('fizz', [t.x, t.y, t.z]);
          this.damageHeld(1);
          return true;
        }
        return false;
      case 'frame':
        if (held?.item === 'eye_of_ender') {
          world.setBlock(t.x, t.y, t.z, B.END_PORTAL_FRAME_EYE);
          this.consumeHeld();
          this.sound('portal', [t.x, t.y, t.z], 0.6);
          if (checkEndPortal(world, t.x, t.y, t.z)) {
            this.hud?.toast('The End portal is open');
            this.sound('portal', [t.x, t.y, t.z]);
          }
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  interactEntity(e, held) {
    if (e.kind !== 'mob') return;
    const def = e.def;
    if (held && def.food === held.item && def.passive) {
      if (e.growUp < 0) {
        e.growUp = Math.min(0, e.growUp + 600);
        this.consumeHeld();
      } else if (!e.inLove && !(e.breedCooldown > 0)) {
        e.inLove = 600;
        this.consumeHeld();
        this.particles.burst([e.pos[0], e.pos[1] + e.h, e.pos[2]], 'heart', 4, 0.4);
      }
      this.swing = 0;
      return;
    }
    if (held?.item === 'shears' && e.type === 'sheep' && !e.sheared && !(e.growUp < 0)) {
      e.sheared = true;
      this.dropStacks([e.pos[0], e.pos[1] + 1, e.pos[2]], [{ item: 'wool_white', count: 1 + Math.floor(Math.random() * 3) }]);
      this.damageHeld(1);
      this.swing = 0;
    }
  }

  // Cell the player is building into: the face they clicked, or the clicked block if it can be replaced.
  placeCell(t) {
    const id = this.world.getBlock(t.x, t.y, t.z);
    if (isReplaceable(id) && !FLUID[id]) return [t.x, t.y, t.z];
    return [t.x + t.normal[0], t.y + t.normal[1], t.z + t.normal[2]];
  }

  canPlaceAt(x, y, z, id) {
    const world = this.world;
    if (y < 0 || y >= HEIGHT || !world.isLoaded(x, z)) return false;
    if (!isReplaceable(world.getBlock(x, y, z))) return false;
    const shapes = COLLISION[id];
    if (shapes && !this.player.spectator) {
      for (const s of shapes) {
        const b = [x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]];
        if (this.player.intersects(b)) return false;
        if (this.entities.inBox(b, (e) => e.kind === 'mob' && e.deathTime === 0).length) return false;
      }
    }
    return true;
  }

  useItem(item, held, t) {
    const world = this.world;
    const p = this.player;
    // Armour goes straight onto the body.
    if (item.armor) {
      const slots = this.inventory.armor.slots;
      const old = slots[item.armor.slot];
      slots[item.armor.slot] = held;
      this.inventory.main.slots[this.selected] = old;
      this.hud?.refreshHotbar();
      return true;
    }
    switch (item.use) {
      case 'throw_pearl': {
        const look = p.look;
        const e = projectile('pearl', p.eye[0], p.eye[1] - 0.1, p.eye[2], look.map((v) => v * 22), 'player');
        this.entities.add(e);
        this.consumeHeld();
        return true;
      }
      case 'eye': {
        const s = world.dimension === 'overworld' ? world.terrain.locate('stronghold', p.pos[0], p.pos[2]) : null;
        if (!s) {
          this.hud?.toast('The eye has nowhere to go here');
          return false;
        }
        const e = projectile('eye', p.eye[0], p.eye[1], p.eye[2], [0, 0, 0], 'player');
        e.target = [s.x + 0.5, s.y, s.z + 0.5];
        e.start = [...p.eye];
        this.entities.add(e);
        this.consumeHeld();
        this.sound('teleport', p.pos, 0.6);
        return true;
      }
      case 'bucket': {
        const hit = raycast(world, p.eye, p.look, 5, { fluids: true });
        if (!hit || !FLUID[hit.id] || FLUID_LEVEL[hit.id] !== 0) return false;
        world.setBlock(hit.x, hit.y, hit.z, B.AIR);
        if (p.vulnerable) this.replaceHeld({ item: FLUID[hit.id] === 1 ? 'water_bucket' : 'lava_bucket', count: 1, damage: 0 });
        this.sound('splash', [hit.x, hit.y, hit.z], 0.6);
        return true;
      }
      case 'pour': {
        if (!t) return false;
        const [x, y, z] = this.placeCell(t);
        const cur = world.getBlock(x, y, z);
        if (!isReplaceable(cur) && !FLUID[cur]) return false;
        if (item.fluid === 1 && world.dimension === 'nether') {
          this.sound('fizz', [x, y, z]);
          this.particles.burst([x + 0.5, y + 0.5, z + 0.5], 'smoke', 10, 0.5);
        } else {
          if (cur !== B.AIR && !FLUID[cur]) this.breakNaturally(x, y, z);
          world.setBlock(x, y, z, fluidBlock(item.fluid, 0));
        }
        if (p.vulnerable) this.replaceHeld({ item: 'bucket', count: 1, damage: 0 });
        return true;
      }
      case 'ignite': {
        if (!t) return false;
        const [x, y, z] = this.placeCell(t);
        if (world.getBlock(x, y, z) !== B.AIR) return false;
        if (tryLightPortal(world, x, y, z)) {
          this.sound('portal', [x, y, z], 0.8);
        } else if (SOLID[world.getBlock(x, y - 1, z)]) {
          world.setBlock(x, y, z, B.FIRE);
          this.sound('fizz', [x, y, z], 0.5);
        } else return false;
        this.damageHeld(1);
        return true;
      }
      case 'hoe': {
        if (!t || t.normal[1] < 0) return false;
        const id = world.getBlock(t.x, t.y, t.z);
        if ((id === B.GRASS || id === B.DIRT) && world.getBlock(t.x, t.y + 1, t.z) === B.AIR) {
          world.setBlock(t.x, t.y, t.z, B.FARMLAND);
          playBlockSound('grass', 'place');
          this.damageHeld(1);
          return true;
        }
        return false;
      }
      case 'bone_meal': {
        if (!t) return false;
        const id = world.getBlock(t.x, t.y, t.z);
        const def = BLOCKS[id];
        if (def.crop !== undefined && def.crop < 7) {
          world.setBlock(t.x, t.y, t.z, B[`WHEAT_${Math.min(7, def.crop + 2 + Math.floor(Math.random() * 3))}`]);
        } else if (def.sapling) {
          if (Math.random() < 0.45) this.updater.growTree(t.x, t.y, t.z, def.sapling);
        } else if (id === B.GRASS) {
          for (let i = 0; i < 16; i++) {
            const x = t.x + Math.floor(Math.random() * 7) - 3;
            const z = t.z + Math.floor(Math.random() * 7) - 3;
            if (world.getBlock(x, t.y, z) === B.GRASS && world.getBlock(x, t.y + 1, z) === B.AIR) {
              world.setBlock(x, t.y + 1, z, Math.random() < 0.85 ? B.TALL_GRASS : Math.random() < 0.5 ? B.POPPY : B.DANDELION);
            }
          }
        } else return false;
        this.particles.burst([t.x + 0.5, t.y + 0.8, t.z + 0.5], 'heart', 4, 0.4);
        this.consumeHeld();
        return true;
      }
      case 'plant': {
        if (!t) return false;
        const [x, y, z] = this.placeCell(t);
        const id = B[item.plants.toUpperCase()];
        const below = world.getBlock(x, y - 1, z);
        if (!canSupportPlant(id, below)) return false;
        if (id === B.SUGAR_CANE && below !== B.SUGAR_CANE) {
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => FLUID[world.getBlock(x + dx, y - 1, z + dz)] === 1);
          if (!wet) {
            this.hud?.toast('Sugar cane needs water right next to it');
            return false;
          }
        }
        if (!this.canPlaceAt(x, y, z, id)) return false;
        world.setBlock(x, y, z, id);
        playBlockSound('grass', 'place');
        this.consumeHeld();
        return true;
      }
      case 'door':
        return this.placeDoor(t);
      case 'bed':
        return this.placeBed(t);
      default:
        break;
    }
    if (item.blockId !== undefined || item.place) return this.placeBlock(item, t);
    return false;
  }

  placeBlock(item, t) {
    if (!t) return false;
    const world = this.world;
    const p = this.player;
    const [x, y, z] = this.placeCell(t);
    const n = t.normal;
    let id = item.blockId;
    if (item.place === 'torch') {
      if (n[1] > 0 || sameDir(n, [0, 0, 0])) id = B.TORCH;
      else if (n[1] < 0) return false;
      else id = facingBlock('wall_torch', [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]].findIndex((d) => sameDir(d, n)));
      if (id === B.TORCH && !SOLID[world.getBlock(x, y - 1, z)]) return false;
    } else if (item.place === 'facing') {
      id = facingBlock(item.block, facingTowardViewer(p.yaw));
    } else if (item.place === 'ladder') {
      if (n[1] !== 0) return false;
      id = facingBlock('ladder', [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]].findIndex((d) => sameDir(d, n)));
    }
    if (id === undefined) return false;
    const def = BLOCKS[id];
    if (PLANT[id] && !canSupportPlant(id, world.getBlock(x, y - 1, z))) return false;
    if (id === B.CACTUS && !this.updater.supported(x, y, z, id, def)) return false;
    if (!this.canPlaceAt(x, y, z, id)) return false;
    if (def.needsSupport === 'behind') {
      const [dx, dz] = FACING_DIR[def.facing];
      if (!SOLID[world.getBlock(x - dx, y, z - dz)]) return false;
    }
    world.setBlock(x, y, z, id);
    if (def.entity === 'furnace') world.blockEntities.set(posKey(x, y, z), newFurnace());
    if (def.entity === 'chest') world.blockEntities.set(posKey(x, y, z), { type: 'chest', slots: new Array(27).fill(null) });
    if (def.entity === 'spawner') world.blockEntities.set(posKey(x, y, z), { type: 'spawner', mob: 'zombie', delay: 200 });
    playBlockSound(def.sound, 'place');
    this.stats.blocksPlaced++;
    this.consumeHeld();
    return true;
  }

  placeDoor(t) {
    if (!t || t.normal[1] <= 0) return false;
    const world = this.world;
    const [x, y, z] = this.placeCell(t);
    const f = facingOfLook(this.player.yaw);
    const lower = B[`OAK_DOOR_LOWER_${'NESW'[f]}`];
    const upper = B[`OAK_DOOR_UPPER_${'NESW'[f]}`];
    if (!SOLID[world.getBlock(x, y - 1, z)] || !this.canPlaceAt(x, y, z, lower) || !this.canPlaceAt(x, y + 1, z, upper)) return false;
    world.setBlock(x, y + 1, z, upper);
    world.setBlock(x, y, z, lower);
    playBlockSound('wood', 'place');
    this.consumeHeld();
    return true;
  }

  placeBed(t) {
    if (!t || t.normal[1] <= 0) return false;
    const world = this.world;
    const [x, y, z] = this.placeCell(t);
    const f = facingOfLook(this.player.yaw);
    const [dx, dz] = FACING_DIR[f];
    const foot = B[`BED_FOOT_${'NESW'[f]}`];
    const head = B[`BED_HEAD_${'NESW'[f]}`];
    if (!SOLID[world.getBlock(x, y - 1, z)] || !SOLID[world.getBlock(x + dx, y - 1, z + dz)]) return false;
    if (!this.canPlaceAt(x, y, z, foot) || !this.canPlaceAt(x + dx, y, z + dz, head)) return false;
    world.setBlock(x + dx, y, z + dz, head);
    world.setBlock(x, y, z, foot);
    playBlockSound('cloth', 'place');
    this.consumeHeld();
    return true;
  }

  updateUsing(dt) {
    const u = this.using;
    if (!this.held[2] || this.heldItem() !== (u.kind === 'bow' ? 'bow' : u.item)) {
      this.finishUsing(true);
      return;
    }
    u.time += dt;
    if (u.kind === 'eat') {
      if (Math.floor(u.time * 5) !== Math.floor((u.time - dt) * 5)) {
        this.sound('eat', this.player.pos, 0.7);
        const eye = this.player.eye;
        const look = this.player.look;
        const item = ITEMS[u.item];
        if (item.layer >= 0) {
          for (let i = 0; i < 3; i++) this.particles.add({
            pos: [eye[0] + look[0] * 0.5, eye[1] - 0.25, eye[2] + look[2] * 0.5],
            vel: [(Math.random() - 0.5) * 1.5, 1.5, (Math.random() - 0.5) * 1.5],
            life: 0.5, size: 0.04, layer: item.layer, u0: Math.random() * 0.75, v0: Math.random() * 0.75, uw: 0.25, color: [1, 1, 1], gravity: 12, collide: true,
          });
        }
      }
      if (u.time >= 1.6) this.finishEating();
    }
  }

  finishEating() {
    const p = this.player;
    const item = ITEMS[this.using.item];
    this.using = null;
    p.food = Math.min(20, p.food + item.food.hunger);
    p.saturation = Math.min(p.food, p.saturation + item.food.saturation);
    if (item.food.regen) p.regenEffect = 100;
    if (item.food.poison && Math.random() < item.food.poison) {
      p.exhaustion += 6;
      this.hud?.toast('That made you feel queasy');
    }
    this.sound('burp', p.pos, 0.6);
    this.consumeHeld();
  }

  finishUsing(released) {
    const u = this.using;
    this.using = null;
    if (!u || !released || u.kind !== 'bow') return;
    const p = this.player;
    const power = Math.min(1, u.time);
    const f = Math.min(1, (power * power + power * 2) / 3);
    if (f < 0.1) return;
    const arrow = this.shootArrow(p.eye, p.look, f * 60, 'player', 0.02, p.vulnerable);
    arrow.crit = f >= 1;
    if (p.vulnerable) this.inventory.main.remove('arrow', 1);
    this.damageHeld(1);
    this.sound('bow', p.pos);
    this.hud?.refreshHotbar();
  }

  shootArrow(from, dir, speed, owner, spread, pickup) {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = dir.map((v) => v / len + (Math.random() - 0.5) * spread);
    const l2 = Math.hypot(d[0], d[1], d[2]);
    const vel = d.map((v) => (v / l2) * speed);
    const e = projectile('arrow', from[0], from[1], from[2], vel, owner);
    e.pickup = pickup;
    this.entities.add(e);
    return e;
  }

  makeProjectile(type, from, vel, owner) {
    return projectile(type, from[0], from[1], from[2], vel, owner);
  }

  projectileHit(e, target, speed) {
    const owner = typeof e.owner === 'number' ? this.entities.list.find((x) => x.id === e.owner) : null;
    e.removed = true;
    if (e.type === 'pearl') {
      this.pearlLand(e);
      return;
    }
    if (target !== 'player' && target.kind === 'crystal') {
      this.dragonFight.crystalDestroyed(target);
      return;
    }
    if (e.type === 'arrow') {
      let dmg = Math.ceil((speed / 20) * 2);
      if (e.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      if (target === 'player') this.damagePlayer(dmg, 'arrow', owner ?? e);
      else if (target.kind === 'mob') hurtMob(target, dmg, this, { kind: 'arrow', entity: e.owner === 'player' ? 'player' : null, dir: e.vel, knockback: 0.6 });
      this.sound('arrow_hit', e.pos);
    } else if (e.type === 'fireball') {
      if (target === 'player') {
        if (this.damagePlayer(5, 'fireball', owner ?? e)) this.player.fireTicks = Math.max(this.player.fireTicks, 100);
      } else if (target.kind === 'mob') {
        if (hurtMob(target, 5, this, { kind: 'fireball' })) target.fire = Math.max(target.fire, 100);
      }
    }
  }

  projectileHitBlock(e, hit) {
    if (e.type === 'pearl') {
      e.removed = true;
      this.pearlLand(e);
    } else if (e.type === 'fireball') {
      e.removed = true;
      const back = [hit.point[0] - e.vel[0] * 0.01, hit.point[1] - e.vel[1] * 0.01, hit.point[2] - e.vel[2] * 0.01].map(Math.floor);
      if (this.gamerules.mobGriefing && this.world.getBlock(...back) === B.AIR && SOLID[this.world.getBlock(back[0], back[1] - 1, back[2])]) {
        this.world.setBlock(...back, B.FIRE);
      }
    }
  }

  pearlLand(e) {
    if (e.owner !== 'player') return;
    const p = this.player;
    this.particles.burst(p.pos, 'portal', 16, 0.6);
    const pos = [...e.pos];
    // Step back out of whatever was hit so the player lands in open air.
    for (let k = 0; k < 8 && SOLID[this.world.getBlock(Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2]))]; k++) {
      pos[0] -= e.vel[0] * 0.01;
      pos[1] -= e.vel[1] * 0.01;
      pos[2] -= e.vel[2] * 0.01;
    }
    p.pos = [pos[0], pos[1], pos[2]];
    p.vel = [0, 0, 0];
    p.fallDistance = 0;
    this.sound('teleport', p.pos);
    this.damagePlayer(5, 'pearl', null, true);
  }

  // ---------------------------------------------------------------- explosions

  explode(x, y, z, power, { source = null, griefing = true, fire = false } = {}) {
    const world = this.world;
    this.sound('explode', [x, y, z]);
    this.particles.burst([x, y, z], 'explosion', 24, power * 0.5);
    if (griefing) {
      const hit = new Map();
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
          for (let k = 0; k < 16; k++) {
            if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
            let dx = i / 15 * 2 - 1;
            let dy = j / 15 * 2 - 1;
            let dz = k / 15 * 2 - 1;
            const len = Math.hypot(dx, dy, dz);
            dx /= len; dy /= len; dz /= len;
            let intensity = power * (0.7 + Math.random() * 0.6);
            let px = x;
            let py = y;
            let pz = z;
            while (intensity > 0) {
              const bx = Math.floor(px);
              const by = Math.floor(py);
              const bz = Math.floor(pz);
              const id = world.getBlock(bx, by, bz, B.BEDROCK);
              if (id !== B.AIR) {
                intensity -= (BLOCKS[id].resistance + 0.3) * 0.3;
                if (intensity > 0 && BLOCKS[id].hardness >= 0 && !FLUID[id]) hit.set(`${bx},${by},${bz}`, id);
              }
              px += dx * 0.3;
              py += dy * 0.3;
              pz += dz * 0.3;
              intensity -= 0.225;
            }
          }
        }
      }
      for (const [key, id] of hit) {
        const [bx, by, bz] = key.split(',').map(Number);
        if (by <= 0 && id === B.BEDROCK) continue;
        if (id === B.TNT) {
          world.setBlock(bx, by, bz, B.AIR);
          this.entities.add(primedTnt(bx, by, bz, 10 + Math.floor(Math.random() * 20)));
          continue;
        }
        const def = BLOCKS[id];
        if (def.entity === 'chest' || def.entity === 'furnace') this.dropContainer(bx, by, bz);
        world.setBlock(bx, by, bz, B.AIR);
        if (Math.random() < 1 / power) this.dropStacks([bx + 0.5, by + 0.5, bz + 0.5], dropsFor(id, 'diamond_pickaxe'));
      }
      if (fire) {
        for (const key of hit.keys()) {
          const [bx, by, bz] = key.split(',').map(Number);
          if (Math.random() < 0.3 && world.getBlock(bx, by, bz) === B.AIR && SOLID[world.getBlock(bx, by - 1, bz)]) world.setBlock(bx, by, bz, B.FIRE);
        }
      }
    }
    // Hurt and fling everything nearby.
    const reach = power * 2;
    const scale = source?.def?.hostile ? { easy: 0.5, normal: 1, hard: 1.5 }[this.difficulty] ?? 1 : 1;
    const impact = (cx, cy, cz) => {
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d >= reach) return null;
      const exposure = this.exposure([cx, cy, cz], [x, y, z]);
      const f = (1 - d / reach) * exposure;
      return { f, dir: [(cx - x) / (d || 1), (cy - y) / (d || 1), (cz - z) / (d || 1)] };
    };
    for (const e of this.entities.list) {
      if (e.removed || e === source) continue;
      const c = e.centre ? e.centre() : e.pos;
      const im = impact(c[0], c[1], c[2]);
      if (!im) continue;
      const dmg = Math.floor(((im.f * im.f + im.f) / 2) * 7 * reach + 1);
      if (e.kind === 'mob') hurtMob(e, dmg, this, { kind: 'explosion' });
      else if (e.kind === 'crystal') this.dragonFight.crystalDestroyed(e);
      else if (e.kind === 'item') { if (dmg > 4) e.removed = true; }
      if (e.vel && e.type !== 'dragon') for (let a = 0; a < 3; a++) e.vel[a] += im.dir[a] * im.f * 16;
    }
    const p = this.player;
    const im = impact(p.pos[0], p.pos[1] + 0.9, p.pos[2]);
    if (im) {
      const dmg = Math.floor(((im.f * im.f + im.f) / 2) * 7 * reach + 1) * scale;
      this.damagePlayer(dmg, 'explosion', source);
      for (let a = 0; a < 3; a++) p.vel[a] += im.dir[a] * im.f * 14;
    }
  }

  // Fraction of rays from a body to an explosion that aren't blocked.
  exposure(from, to) {
    let open = 0;
    const samples = [[0, 0, 0], [0.3, 0.5, 0.3], [-0.3, 0.5, -0.3], [0.3, -0.4, -0.3], [-0.3, -0.4, 0.3]];
    for (const [ox, oy, oz] of samples) {
      const a = [from[0] + ox, from[1] + oy, from[2] + oz];
      const d = [to[0] - a[0], to[1] - a[1], to[2] - a[2]];
      const len = Math.hypot(...d);
      let blocked = false;
      for (let s = 0.5; s < len; s += 0.5) {
        const id = this.world.getBlock(Math.floor(a[0] + (d[0] / len) * s), Math.floor(a[1] + (d[1] / len) * s), Math.floor(a[2] + (d[2] / len) * s));
        if (SOLID[id] && BLOCKS[id].opaque !== false) { blocked = true; break; }
      }
      if (!blocked) open++;
    }
    return open / samples.length;
  }

  // ---------------------------------------------------------------- beds and sleep

  trySleep(t) {
    const world = this.world;
    const p = this.player;
    if (world.dimension !== 'overworld') {
      world.setBlock(t.x, t.y, t.z, B.AIR);
      this.explode(t.x + 0.5, t.y + 0.5, t.z + 0.5, 5, { fire: true });
      return;
    }
    const t0 = this.timeOfDay;
    const night = t0 > 0.52 && t0 < 0.98;
    this.setSpawn([t.x, t.y, t.z], 'overworld');
    if (!night) {
      this.hud?.toast('Respawn point set. You can only sleep at night.');
      return;
    }
    const monsters = this.entities.mobs((e) => e.def.hostile && Math.abs(e.pos[0] - p.pos[0]) < 8 && Math.abs(e.pos[1] - p.pos[1]) < 5 && Math.abs(e.pos[2] - p.pos[2]) < 8);
    if (monsters.length) {
      this.hud?.toast('You may not rest now; there are monsters nearby');
      return;
    }
    this.state = 'sleeping';
    this.sleepTicks = 0;
    this.advancements.event('sleep');
    this.hud?.sleep(0);
  }

  tickSleep() {
    this.sleepTicks++;
    this.hud?.sleep(Math.min(1, this.sleepTicks / 60));
    if (this.sleepTicks >= 100) {
      this.dayTicks += DAY_TICKS - (this.dayTicks % DAY_TICKS) + 0;
      this.state = 'playing';
      this.hud?.sleep(null);
      this.hud?.toast('Good morning');
    }
  }

  // ---------------------------------------------------------------- portals and dimensions

  checkPortals() {
    const p = this.player;
    const b = p.box();
    let nether = false;
    let end = false;
    forBlocksIn(this.world, b[0], b[1], b[2], b[3], b[4], b[5], (id) => {
      if (BLOCKS[id].portal === 'nether') nether = true;
      if (BLOCKS[id].portal === 'end') end = true;
      return false;
    });
    if (!nether && !end) {
      p.portalTime = 0;
      p.portalImmune = false;
      this.hud?.overlay('portal', 0);
      return;
    }
    if (p.portalImmune) return;
    if (end) {
      p.portalImmune = true;
      if (this.world.dimension === 'end') this.finishGame();
      else this.travel('end');
      return;
    }
    p.portalTime = (p.portalTime ?? 0) + 1;
    const need = p.vulnerable ? 80 : 4;
    this.hud?.overlay('portal', Math.min(1, p.portalTime / need));
    if (p.portalTime === 1) this.sound('portal', p.pos, 0.7);
    if (p.portalTime >= need) {
      p.portalTime = 0;
      p.portalImmune = true;
      this.travel(this.world.dimension === 'nether' ? 'overworld' : 'nether');
    }
  }

  travel(dim) {
    const p = this.player;
    const from = this.world.dimension;
    const [x, y, z] = p.pos;
    this.switchWorld(dim);
    const world = this.world;
    if (dim === 'end') {
      const s = END_SPAWN;
      world.ensureChunk(6, -1);
      world.ensureChunk(6, 0);
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          world.setBlock(100 + dx, 48, dz, B.OBSIDIAN);
          for (let h = 49; h <= 51; h++) world.setBlock(100 + dx, h, dz, B.AIR);
        }
      }
      p.teleport(s.x, s.y, s.z);
      p.yaw = Math.PI / 2;
      this.advancements.event('end');
      this.dragonFight.begin();
    } else {
      const scale = dim === 'nether' ? 1 / 8 : from === 'nether' ? 8 : 1;
      const arrive = arriveThroughPortal(world, Math.floor(x * scale), Math.floor(y), Math.floor(z * scale));
      p.teleport(...arrive.pos);
      p.yaw = arrive.yaw;
      if (dim === 'nether') this.advancements.event('nether');
    }
    p.portalImmune = true;
    this.placeOnArrival = 'saved';
    this.playerReady = false;
    this.hud?.overlay('portal', 0);
    this.sound('portal', p.pos, 0.5);
  }

  finishGame() {
    this.state = 'credits';
    this.hud?.showCredits(this.stats);
  }

  // After the credits: home to the overworld.
  returnFromEnd() {
    this.respawnHome();
  }

  respawnHome() {
    const p = this.player;
    let target = null;
    if (this.spawn) {
      const w = this.loadWorld(this.spawn.dim ?? 'overworld');
      const [x, y, z] = this.spawn.pos.map(Math.floor);
      w.ensureChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
      if (BLOCKS[w.getBlock(x, y, z)].bed) target = [x + 0.5, y + 0.6, z + 0.5];
    }
    this.switchWorld('overworld');
    if (target) {
      p.teleport(...target);
      this.placeOnArrival = 'saved';
    } else {
      p.teleport(this.worldSpawn.x, this.worldSpawn.y, this.worldSpawn.z);
      this.placeOnArrival = 'surface';
    }
    this.playerReady = false;
    this.state = 'playing';
  }

  onDragonKilled() {
    this.advancements.event('dragon');
    this.hud?.toast('The Ender Dragon is dead. The exit portal is open at the centre of the island.');
    this.dropStacks([0.5, this.worlds.end.terrain.portalY + 2, 0.5], []);
  }

  onMobKilled(e, source) {
    if (source.entity === 'player' || source.kind === 'player' || e.lastHitByPlayer !== undefined) {
      this.stats.mobsKilled++;
      if (e.def.hostile) this.advancements.event('kill');
    }
  }

  onPickup() {
    this.advancements.check(this.inventory);
  }

  onAdvancement(a) {
    this.hud?.advancement(a);
    playSound('levelup', 0.8);
  }

  openScreen(kind, data) {
    this.openContainer = { kind, data };
    this.held = { 0: false, 2: false };
    this.mining = null;
    this.hud?.openScreen(kind, data);
  }

  // ---------------------------------------------------------------- rendering

  // Build the renderer's frame description from the current state.
  view(settings, titleCamera) {
    const p = this.player;
    const sky = skyAt(this.world.dimension === 'overworld' ? this.timeOfDay : 0.75);
    this.skyState = sky;
    const dim = this.world.dimension;
    const style = DIM_STYLE[dim];
    const alpha = this.accumulator / TICK;
    let cam;
    let yaw;
    let pitch;
    let roll = 0;
    let fov = settings.fov;
    if (titleCamera) {
      ({ cam, yaw, pitch } = titleCamera);
    } else {
      cam = p.eye;
      yaw = p.yaw;
      pitch = p.pitch;
      const targetFov = fov * (p.sprinting ? (p.flying ? 1.15 : 1.1) : 1) * (this.using?.kind === 'bow' ? 1 - Math.min(1, this.using.time) * 0.15 : 1);
      this.fovNow = this.fovNow ?? fov;
      this.fovNow += (targetFov - this.fovNow) * 0.15;
      fov = this.fovNow;
      const speed = Math.hypot(p.vel[0], p.vel[2]);
      const bobTarget = settings.bobbing && p.onGround && !p.flying ? Math.min(1, speed / 4.3) : 0;
      this.bobAmount = (this.bobAmount ?? 0) + (bobTarget - (this.bobAmount ?? 0)) * 0.15;
      const phase = p.walkDist * Math.PI * 0.62;
      const bx = Math.sin(phase) * 0.035 * this.bobAmount;
      const by = -Math.abs(Math.cos(phase)) * 0.05 * this.bobAmount;
      cam = [cam[0] + Math.cos(yaw) * bx, cam[1] + by, cam[2] - Math.sin(yaw) * bx];
      if (p.hurtTicks > 0) roll = Math.sin((p.hurtTicks / 10) * Math.PI) * 0.12 * (Math.sin(this.hurtYaw ?? 0) >= 0 ? 1 : -1);
      if (p.dead) { cam[1] -= 1.2; roll = 1.2; }
      if (this.state === 'sleeping') cam[1] -= 1;
      this.handBob = [bx * 0.6, by * 0.6];
    }
    const entities = [];
    const items = [];
    const beams = [];
    for (const e of this.entities.list) {
      if (e.removed) continue;
      const pos = [e.prev[0] + (e.pos[0] - e.prev[0]) * alpha, e.prev[1] + (e.pos[1] - e.prev[1]) * alpha, e.prev[2] + (e.pos[2] - e.prev[2]) * alpha];
      if (Math.hypot(pos[0] - cam[0], pos[2] - cam[2]) > settings.renderDistance * CHUNK) continue;
      if (e.kind === 'mob') {
        const baby = e.growUp < 0;
        const light = e.type === 'blaze' ? [1, 1, 1] : this.lightColor(pos[0], pos[1] + e.h * 0.6, pos[2]);
        const hurt = e.hurtTime > 0 || e.deathTime > 0;
        let overlay = hurt ? [1, 0, 0, 0.45] : null;
        let scale = baby ? 0.5 : 1;
        if (e.type === 'creeper' && e.fuse > 0) {
          const f = e.fuse / 30;
          scale *= 1 + f * 0.15;
          if (Math.floor(e.fuse / 3) % 2 === 0) overlay = [1, 1, 1, 0.5];
        }
        if (e.type === 'dragon') scale = 1.6;
        const bodyYaw = e.prevBodyYaw !== undefined ? e.prevBodyYaw + ((e.bodyYaw - e.prevBodyYaw)) * alpha : e.bodyYaw;
        entities.push({
          model: MOBS[e.type].model,
          pos: e.type === 'dragon' ? [pos[0], pos[1] + 2, pos[2]] : pos,
          yaw: bodyYaw,
          roll: e.deathTime > 0 && e.type !== 'dragon' ? Math.min(1, e.deathTime / 15) * (Math.PI / 2) : 0,
          scale,
          light,
          overlay,
          state: e,
          t: this.tickCount + alpha,
        });
        if (e.type === 'dragon' && e.healer) beams.push([[e.healer.pos[0], e.healer.pos[1] + 1, e.healer.pos[2]], [pos[0], pos[1] + 2, pos[2]]]);
      } else if (e.kind === 'crystal') {
        entities.push({ model: 'crystal', pos, yaw: 0, scale: 2, light: [1, 1, 1], state: e, t: this.tickCount + alpha });
      } else if (e.kind === 'item') {
        const item = ITEMS[e.stack.item];
        const sprite = item.layer >= 0;
        const bob = Math.sin((this.tickCount + alpha) * 0.1 + e.spin) * 0.08 + 0.12;
        const light = this.lightColor(pos[0], pos[1] + 0.2, pos[2])[0];
        const yawSpin = (this.tickCount + alpha) * 0.05 + e.spin;
        const copies = e.stack.count > 16 ? 3 : e.stack.count > 1 ? 2 : 1;
        for (let k = 0; k < copies; k++) {
          items.push({ key: e.stack.item, pos: [pos[0] + k * 0.06, pos[1] + bob + k * 0.05, pos[2] + k * 0.04], yaw: yawSpin, scale: sprite ? 0.45 : 0.25, light, sprite });
        }
      } else if (e.kind === 'tnt') {
        const flash = Math.floor(e.fuse / 5) % 2 === 0 ? [1, 1, 1, 0.55] : null;
        items.push({ key: 'tnt', pos: [pos[0], pos[1] + 0.5, pos[2]], yaw: 0, scale: 1 + (e.fuse < 10 ? (10 - e.fuse) * 0.02 : 0), light: this.lightColor(pos[0], pos[1] + 0.5, pos[2])[0], overlay: flash });
      } else if (e.kind === 'projectile') {
        if (e.type === 'arrow') entities.push({ model: 'arrow', pos, yaw: e.yaw, pitch: -e.pitch, scale: 1, light: this.lightColor(pos[0], pos[1], pos[2]), state: e, t: 0 });
        else if (e.type === 'pearl' || e.type === 'eye') items.push({ key: e.type === 'pearl' ? 'ender_pearl' : 'eye_of_ender', pos: [pos[0], pos[1] - 0.12, pos[2]], yaw: yaw + Math.PI, scale: 0.3, light: 1, sprite: true });
        else items.push({ key: 'fire_charge', pos: [pos[0], pos[1] - 0.15, pos[2]], yaw: this.tickCount * 0.3, scale: 0.35, light: 1 });
      }
    }
    let crack = null;
    if (this.mining?.progress > 0 && this.target && !this.target.entity) {
      crack = { x: this.mining.x, y: this.mining.y, z: this.mining.z, id: this.mining.id, stage: Math.min(9, Math.floor(this.mining.progress * 10)) };
    }
    let hand = null;
    if (!titleCamera && !p.dead && !p.spectator && settings.showHand !== false) {
      const handLight = this.lightColor(cam[0], cam[1], cam[2]);
      hand = {
        key: this.heldItem(),
        swing: this.swing,
        bob: this.handBob ?? [0, 0],
        light: Math.max(handLight[0], handLight[1], handLight[2]),
        eat: this.using?.kind === 'eat' ? this.using.time : 0,
        pull: this.using?.kind === 'bow' ? Math.min(1, this.using.time) : 0,
        bow: this.heldItem() === 'bow',
      };
    }
    const feet = this.world.getBlock(Math.floor(cam[0]), Math.floor(cam[1]), Math.floor(cam[2]));
    return {
      cam, yaw, pitch, roll,
      fov: (fov * Math.PI) / 180,
      sky,
      dim: style,
      time: this.clock,
      chunks: this.world.chunks.values(),
      renderDistance: settings.renderDistance,
      underwater: !titleCamera && FLUID[feet] === 1,
      inLava: !titleCamera && FLUID[feet] === 2,
      target: !titleCamera && this.state === 'playing' && this.target && !this.target.entity ? { x: this.target.x, y: this.target.y, z: this.target.z, boxes: this.target.boxes } : null,
      crack,
      particles: this.particles.list,
      entities,
      items,
      beams,
      hand,
    };
  }
}

