// Game wiring: menus, the frame loop, block interaction and saving.
import { generateTextures } from './textures.js';
import { B, BLOCKS, SOLID, PLANT, FACE_TEX, canSupportPlant, isReplaceable, RENDER_TYPE, RENDER } from './blocks.js';
import { HEIGHT, CHUNK, BIOME_NAMES } from './terrain.js';
import { World } from './world.js';
import { Streamer } from './streamer.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { raycast } from './raycast.js';
import { skyAt, DAY_SECONDS, clockLabel } from './sky.js';
import { Input } from './input.js';
import { createIconFactory } from './icons.js';
import { buildItemMesh } from './mesher.js';
import { hashString } from './noise.js';
import { startAudio, playBlockSound, setSoundEnabled } from './audio.js';

const SAVE_KEY = 'blockcraft:world:v1';
const SETTINGS_KEY = 'blockcraft:settings:v1';
const REACH = 6;
const REPEAT_SECONDS = 0.22;
const AUTOSAVE_SECONDS = 30;
const DEFAULT_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.PLANKS, B.OAK_LOG, B.GLASS, B.BRICKS, B.GLOWSTONE];
const SEED_WORDS = ['ember', 'quarry', 'meadow', 'basalt', 'harbor', 'thistle', 'canyon', 'lantern', 'willow', 'tundra', 'copper', 'glacier'];

// localStorage can be missing or throw (private windows, blocked storage).
const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

export function seedFromText(text) {
  const t = String(text).trim();
  if (/^-?\d{1,9}$/.test(t)) return Number(t) | 0;
  return hashString(t) | 0;
}

function randomSeedText() {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
    this.settings = {
      renderDistance: this.isTouch ? 4 : 7,
      fov: 75,
      sensitivity: 1,
      sound: true,
      bobbing: true,
      invert: false,
      ...storage.get(SETTINGS_KEY),
    };
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.textures = generateTextures();
    this.renderer.uploadTextures(this.textures);
    this.icon = createIconFactory(this.textures);
    this.streamer = new Streamer(this.renderer);
    this.player = new Player();
    this.player.autoJump = this.isTouch;
    this.state = 'title';
    this.hotbar = [...DEFAULT_HOTBAR];
    this.slot = 0;
    this.timeOfDay = 0.02;
    this.clock = 0;
    this.particles = [];
    this.target = null;
    this.held = { 0: false, 2: false };
    this.nextRepeat = 0;
    this.swing = 1;
    this.lastSpace = 0;
    this.everLocked = false;
    this.suppressPause = false;
    this.playerReady = false;
    this.started = false;
    this.lastStepDist = 0;
    this.autosaveAt = AUTOSAVE_SECONDS;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fovNow = this.settings.fov;
    this.bobAmount = 0;
    this.debug = false;

    this.input = new Input(this.canvas, {
      onLook: (dx, dy) => this.look(dx, dy),
      onAction: (button, down) => this.onAction(button, down),
      onKey: (code, e) => this.onKey(code, e),
      onWheel: (dir) => this.selectSlot((this.slot + dir + 9) % 9),
      onLockChange: (locked) => this.onLockChange(locked),
      onLockError: () => this.onLockError(),
    });

    this.bindUI();
    this.loadInitialWorld();
    this.applySettings();
    this.buildInventory();

    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- worlds

  loadInitialWorld() {
    const saved = storage.get(SAVE_KEY);
    if (saved && typeof saved.seed === 'number') {
      this.openWorld(saved.seed, saved.seedText ?? String(saved.seed), saved);
      this.hasSave = true;
    } else {
      const text = randomSeedText();
      this.openWorld(seedFromText(text), text, null);
      this.hasSave = false;
    }
    $('seed').value = this.seedText;
    this.refreshTitle();
  }

  openWorld(seed, seedText, saved) {
    this.world = new World(seed);
    this.seedText = seedText;
    this.titleY = null;
    this.particles = [];
    this.target = null;
    this.playerReady = false;
    this.fromSave = !!saved;
    if (saved) {
      this.world.loadEdits(saved.edits);
      this.timeOfDay = typeof saved.time === 'number' ? saved.time : 0.02;
      this.spawn = saved.spawn ?? this.world.terrain.findSpawn();
      const p = saved.player ?? {};
      const pos = Array.isArray(p.pos) && p.pos.length === 3 ? p.pos : [this.spawn.x, this.spawn.y, this.spawn.z];
      this.player.teleport(pos[0], pos[1], pos[2]);
      this.player.yaw = p.yaw ?? 0;
      this.player.pitch = p.pitch ?? 0;
      this.player.flying = !!p.flying;
      if (Array.isArray(saved.hotbar) && saved.hotbar.length === 9 && saved.hotbar.every((id) => BLOCKS[id] && !BLOCKS[id].hidden)) {
        this.hotbar = saved.hotbar;
      }
      this.slot = Math.min(8, Math.max(0, saved.slot | 0));
    } else {
      this.timeOfDay = 0.02;
      this.spawn = this.world.terrain.findSpawn();
      this.player.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
      this.player.yaw = Math.PI * 0.75;
      this.player.pitch = -0.1;
      this.player.flying = false;
      this.hotbar = [...DEFAULT_HOTBAR];
      this.slot = 0;
    }
    this.streamer.setWorld(this.world);
    this.renderHotbar();
    this.setItemInHand();
  }

  save() {
    if (!this.world || !this.started) return false;
    const p = this.player;
    const ok = storage.set(SAVE_KEY, {
      version: 1,
      seed: this.world.seed,
      seedText: this.seedText,
      time: this.timeOfDay,
      spawn: this.spawn,
      player: { pos: p.pos.map((v) => Math.round(v * 1000) / 1000), yaw: p.yaw, pitch: p.pitch, flying: p.flying },
      hotbar: this.hotbar,
      slot: this.slot,
      edits: this.world.serializeEdits(),
      savedAt: Date.now(),
    });
    if (ok) this.hasSave = true;
    this.lastSaveOk = ok;
    return ok;
  }

  // The world needs to exist around the player before physics can run.
  tryPlacePlayer() {
    const p = this.player;
    if (this.streamer.progress(p.pos[0], p.pos[2], 1) < 1) return false;
    const x = Math.floor(p.pos[0]);
    const z = Math.floor(p.pos[2]);
    if (!this.fromSave) {
      // Fresh spawn: stand on the real surface (trees and caves can move it).
      const top = this.world.surfaceY(x, z);
      p.teleport(p.pos[0], top + 1, p.pos[2]);
      this.spawn = { x: p.pos[0], y: top + 1, z: p.pos[2] };
      this.fromSave = true;
    } else {
      // Saved position: nudge up if something was built where the player stood.
      let guard = 0;
      while (guard++ < HEIGHT && (SOLID[this.world.getBlock(x, Math.floor(p.pos[1]), z)] || SOLID[this.world.getBlock(x, Math.floor(p.pos[1] + 1), z)])) {
        p.pos[1] = Math.floor(p.pos[1]) + 1;
      }
    }
    return true;
  }

  respawn() {
    const s = this.spawn;
    const top = this.world.surfaceY(Math.floor(s.x), Math.floor(s.z));
    this.player.teleport(s.x, Math.max(top + 1, 1), s.z);
    this.toast('You fell out of the world. Back to spawn.');
  }

  // --------------------------------------------------------------- states

  play() {
    startAudio();
    this.started = true;
    this.state = 'playing';
    $('title').hidden = true;
    $('pause').hidden = true;
    $('inventory').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = this.input.mode !== 'touch';
    if (this.input.mode === 'lock') this.input.requestLock();
    this.updateResumeHint();
  }

  pause() {
    if (this.state === 'title') return;
    this.state = 'paused';
    this.held = { 0: false, 2: false };
    this.save();
    $('pause').hidden = false;
    $('inventory').hidden = true;
    $('touch').hidden = true;
    $('resume-hint').hidden = true;
    this.input.releaseLock();
    const edits = this.world.editCount;
    $('pause-status').innerHTML = `Seed <b>${escapeHtml(this.seedText)}</b> · ${edits} block${edits === 1 ? '' : 's'} changed${this.lastSaveOk === false ? ' · <b>Saving is unavailable in this browser</b>' : ' · Saved'}`;
  }

  openInventory() {
    if (this.state !== 'playing') return;
    this.state = 'inventory';
    this.held = { 0: false, 2: false };
    this.suppressPause = true;
    this.input.releaseLock();
    $('inv-slot').textContent = String(this.slot + 1);
    $('inventory').hidden = false;
    $('touch').hidden = true;
    $('resume-hint').hidden = true;
  }

  closeInventory() {
    if (this.state !== 'inventory') return;
    $('inventory').hidden = true;
    this.play();
  }

  quitToTitle() {
    this.save();
    this.state = 'title';
    this.input.releaseLock();
    $('pause').hidden = true;
    $('hud').hidden = true;
    $('touch').hidden = true;
    $('loading').hidden = true;
    $('title').hidden = false;
    $('seed').value = this.seedText;
    this.refreshTitle();
  }

  onLockChange(locked) {
    if (locked) {
      this.everLocked = true;
      this.updateResumeHint();
      return;
    }
    if (this.suppressPause) {
      this.suppressPause = false;
      return;
    }
    if (this.state === 'playing') this.pause();
  }

  onLockError() {
    // Chrome refuses a re-lock for about a second after Esc; that is not a
    // reason to give up on the mouse. Only fall back if it never worked.
    if (!this.everLocked && this.input.mode === 'lock') {
      this.input.useDragMode();
      this.toast('Drag to look around. Click to break, right-click to place.');
    }
    this.updateResumeHint();
  }

  updateResumeHint() {
    const needsClick = this.state === 'playing' && this.input.mode === 'lock' && !this.input.locked;
    $('resume-hint').hidden = !needsClick;
  }

  // ---------------------------------------------------------------- input

  look(dx, dy) {
    if (this.state !== 'playing') return;
    const k = 0.0023 * this.settings.sensitivity;
    const p = this.player;
    p.yaw -= dx * k;
    p.pitch -= dy * k * (this.settings.invert ? -1 : 1);
    const limit = Math.PI / 2 - 0.001;
    p.pitch = Math.max(-limit, Math.min(limit, p.pitch));
  }

  onAction(button, down) {
    if (this.state !== 'playing') return;
    if (this.input.mode === 'lock' && !this.input.locked) {
      if (down) this.input.requestLock();
      return;
    }
    if (button === 1) {
      if (down) this.pickBlock();
      return;
    }
    if (button !== 0 && button !== 2) return;
    this.held[button] = down;
    if (down) {
      this.use(button);
      this.nextRepeat = this.clock + REPEAT_SECONDS * 1.4;
    }
  }

  use(button) {
    if (!this.playerReady) return;
    if (button === 0) this.breakTarget();
    else this.placeTarget();
  }

  onKey(code, e) {
    if (code === 'Escape') {
      if (this.state === 'inventory') { this.closeInventory(); return true; }
      if (this.state === 'playing' && this.input.mode !== 'lock') { this.pause(); return true; }
      if (this.state === 'paused' && this.input.mode !== 'lock') { this.play(); return true; }
      return false;
    }
    if (code === 'KeyE') {
      if (this.state === 'playing') this.openInventory();
      else if (this.state === 'inventory') this.closeInventory();
      return true;
    }
    if (code.startsWith('Digit') && (this.state === 'playing' || this.state === 'inventory')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) {
        this.selectSlot(n - 1);
        return true;
      }
    }
    if (this.state !== 'playing') return false;
    if (code === 'F3') {
      this.debug = !this.debug;
      $('debug').hidden = !this.debug;
      return true;
    }
    if (code === 'KeyF') {
      this.toggleFlight();
      return true;
    }
    if (code === 'Space' && !e.repeat) {
      if (this.clock - this.lastSpace < 0.3) {
        this.toggleFlight();
        this.lastSpace = 0;
      } else {
        this.lastSpace = this.clock;
      }
      return true;
    }
    return false;
  }

  toggleFlight() {
    const p = this.player;
    p.flying = !p.flying;
    if (p.flying) p.vel[1] = Math.max(p.vel[1], 2);
    this.toast(p.flying ? 'Flying. Space to rise, Shift to sink.' : 'Flying off');
  }

  selectSlot(i) {
    if (i === this.slot) return;
    this.slot = i;
    this.renderHotbar();
    this.setItemInHand();
    $('inv-slot').textContent = String(i + 1);
    this.showHeldName();
  }

  // ------------------------------------------------------------- building

  breakTarget() {
    const t = this.target;
    if (!t) return;
    const id = this.world.breakBlock(t.x, t.y, t.z);
    if (id == null) return;
    this.spawnParticles(t.x, t.y, t.z, id);
    playBlockSound(BLOCKS[id].sound, 'break');
    this.swing = 0;
  }

  placeTarget() {
    const t = this.target;
    if (!t) return;
    const id = this.hotbar[this.slot];
    let x = t.x + t.normal[0];
    let y = t.y + t.normal[1];
    let z = t.z + t.normal[2];
    // Building into grass or flowers replaces them, as you'd expect.
    if (PLANT[t.id]) { x = t.x; y = t.y; z = t.z; }
    if (y < 0 || y >= HEIGHT) return;
    if (!isReplaceable(this.world.getBlock(x, y, z))) return;
    if (PLANT[id] && !canSupportPlant(id, this.world.getBlock(x, y - 1, z))) {
      this.toast(BLOCKS[id].onSand ? `${BLOCKS[id].name} only grows on sand` : `${BLOCKS[id].name} needs grass or dirt underneath`);
      return;
    }
    if (SOLID[id] && this.player.intersectsBlock(x, y, z)) return;
    if (!this.world.placeBlock(x, y, z, id)) return;
    playBlockSound(BLOCKS[id].sound, 'place');
    this.swing = 0;
  }

  pickBlock() {
    const t = this.target;
    if (!t) return;
    const at = this.hotbar.indexOf(t.id);
    if (at >= 0) {
      this.selectSlot(at);
    } else {
      this.hotbar[this.slot] = t.id;
      this.renderHotbar();
      this.setItemInHand();
      this.showHeldName();
    }
  }

  spawnParticles(x, y, z, id) {
    const layer = FACE_TEX[id * 6];
    const light = 0.3 + 0.7 * skyAt(this.timeOfDay).daylight;
    const count = PLANT[id] ? 8 : 20;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        pos: [x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7],
        vel: [(Math.random() - 0.5) * 3.2, Math.random() * 3.5 + 0.5, (Math.random() - 0.5) * 3.2],
        life: 0.45 + Math.random() * 0.6,
        size: 0.045 + Math.random() * 0.045,
        layer,
        u0: Math.floor(Math.random() * 4) * 0.25,
        v0: Math.floor(Math.random() * 4) * 0.25,
        light,
      });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  updateParticles(dt) {
    const w = this.world;
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vel[1] -= 20 * dt;
      const nx = p.pos[0] + p.vel[0] * dt;
      const ny = p.pos[1] + p.vel[1] * dt;
      const nz = p.pos[2] + p.vel[2] * dt;
      if (SOLID[w.getBlock(Math.floor(nx), Math.floor(ny - p.size), Math.floor(nz))]) {
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
      return true;
    });
  }

  setItemInHand() {
    const id = this.hotbar[this.slot];
    const mesh = buildItemMesh(id);
    this.renderer.setItemMesh({ ...mesh, water: RENDER_TYPE[id] === RENDER.LIQUID });
  }

  // ------------------------------------------------------------ main loop

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - (this.last ?? now)) / 1000));
    this.last = now;
    this.clock += dt;
    this.timeOfDay = (this.timeOfDay + dt / DAY_SECONDS) % 1;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    let cam;
    let yaw;
    let pitch;
    let fov = this.settings.fov;
    let hand = null;
    const p = this.player;
    if (this.state === 'title') {
      ({ cam, yaw, pitch } = this.titleCamera());
      this.target = null;
    } else {
      if (this.state === 'playing') this.updatePlaying(dt);
      cam = p.eye;
      yaw = p.yaw;
      pitch = p.pitch;
      // Sprinting widens the view a little.
      const targetFov = fov * (p.sprinting ? (p.flying ? 1.15 : 1.1) : 1);
      this.fovNow += (targetFov - this.fovNow) * Math.min(1, dt * 10);
      fov = this.fovNow;
      const speed = Math.hypot(p.vel[0], p.vel[2]);
      const bobTarget = this.settings.bobbing && p.onGround && !p.flying ? Math.min(1, speed / 4.3) : 0;
      this.bobAmount += (bobTarget - this.bobAmount) * Math.min(1, dt * 8);
      const phase = p.walkDist * Math.PI * 0.62;
      const bx = Math.sin(phase) * 0.035 * this.bobAmount;
      const by = -Math.abs(Math.cos(phase)) * 0.05 * this.bobAmount;
      cam = [cam[0] + Math.cos(yaw) * bx, cam[1] + by, cam[2] - Math.sin(yaw) * bx];
      this.swing = Math.min(1, this.swing + dt * 3.6);
      hand = { swing: this.swing, bob: [bx * 0.6, by * 0.6], light: this.handLight() };
    }

    this.streamer.update(cam[0], cam[2], this.settings.renderDistance);
    this.updateParticles(dt);
    const sky = skyAt(this.timeOfDay);
    const underwater = this.state !== 'title' && p.headInWater;
    this.renderer.render({
      cam, yaw, pitch,
      fov: (fov * Math.PI) / 180,
      sky,
      time: this.clock,
      chunks: this.world.chunks.values(),
      renderDistance: this.settings.renderDistance,
      underwater,
      target: this.state === 'playing' ? this.target : null,
      particles: this.particles,
      hand: this.state === 'title' ? null : hand,
    });
    $('underwater').hidden = !underwater;
    if (this.debug && this.state !== 'title') this.updateDebug(sky);
    if (this.state === 'title') this.updateTitleStatus();
    requestAnimationFrame((t) => this.frame(t));
  }

  // A slow orbit around the spawn point, kept clear of hills.
  titleCamera() {
    const s = this.spawn;
    const a = this.clock * 0.035 + 0.6;
    const r = 34;
    const x = s.x + Math.cos(a) * r;
    const z = s.z + Math.sin(a) * r;
    const ground = Math.max(this.world.terrain.columnInfo(x, z).h, this.world.surfaceY(Math.floor(x), Math.floor(z)));
    const wantY = Math.max(s.y + 22, ground + 12);
    this.titleY = this.titleY == null ? wantY : this.titleY + (wantY - this.titleY) * 0.02;
    const cam = [x, this.titleY, z];
    const d = [s.x - x, s.y + 2 - cam[1], s.z - z];
    const len = Math.hypot(d[0], d[1], d[2]);
    return { cam, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / len) };
  }

  updatePlaying(dt) {
    const p = this.player;
    if (!this.playerReady) {
      const progress = this.streamer.progress(p.pos[0], p.pos[2], 1);
      $('loading').hidden = false;
      $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
      if (!this.tryPlacePlayer()) return;
      this.playerReady = true;
      this.lastStepDist = p.walkDist;
      $('loading').hidden = true;
    }
    const move = this.input.movement();
    const result = p.update(dt, move, this.world);
    if (result.enteredWater) playBlockSound('water', 'splash');
    if (p.onGround && p.walkDist - this.lastStepDist > 1.8) {
      this.lastStepDist = p.walkDist;
      const below = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(p.pos[1] - 0.1), Math.floor(p.pos[2]));
      if (below) playBlockSound(BLOCKS[below].sound, 'step');
    }
    if (p.pos[1] < -40) this.respawn();

    this.target = raycast(this.world, p.eye, p.look, REACH);
    for (const button of [0, 2]) {
      if (this.held[button] && this.clock >= this.nextRepeat) {
        this.use(button);
        this.nextRepeat = this.clock + REPEAT_SECONDS;
      }
    }

    this.autosaveAt -= dt;
    if (this.autosaveAt <= 0) {
      this.autosaveAt = AUTOSAVE_SECONDS;
      this.save();
    }
  }

  // Rough light for the held block: full daylight under open sky, dimmer under cover.
  handLight() {
    const p = this.player;
    const x = Math.floor(p.pos[0]);
    const z = Math.floor(p.pos[2]);
    const open = this.world.surfaceY(x, z) < p.pos[1] + p.eyeHeight;
    return open ? 1 : 0.45;
  }

  // -------------------------------------------------------------------- UI

  bindUI() {
    $('btn-play').addEventListener('click', () => this.onPlayClicked());
    $('btn-new').addEventListener('click', () => this.onNewWorldClicked());
    $('seed-shuffle').addEventListener('click', () => {
      $('seed').value = randomSeedText();
      this.refreshTitle();
    });
    $('seed').addEventListener('input', () => this.refreshTitle());
    $('seed').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onPlayClicked();
    });
    $('btn-resume').addEventListener('click', () => this.play());
    // After a refused or lost pointer lock, a click on the world takes it back.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && this.input.mode === 'lock' && !this.input.locked) this.input.requestLock();
    });
    $('btn-quit').addEventListener('click', () => this.quitToTitle());
    $('inv-close').addEventListener('click', () => this.closeInventory());
    $('inventory').addEventListener('click', (e) => {
      if (e.target === $('inventory')) this.closeInventory();
    });

    const range = (id, key, format) => {
      const el = $(id);
      const out = $(id.replace('opt-', 'out-'));
      el.value = String(this.settings[key]);
      out.textContent = format(this.settings[key]);
      el.addEventListener('input', () => {
        this.settings[key] = Number(el.value);
        out.textContent = format(this.settings[key]);
        this.applySettings();
      });
    };
    range('opt-distance', 'renderDistance', (v) => `${v} chunks · ${v * CHUNK} blocks`);
    range('opt-fov', 'fov', (v) => `${v}°`);
    range('opt-sens', 'sensitivity', (v) => `${v.toFixed(1)}×`);
    const toggle = (id, key) => {
      const el = $(id);
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        this.settings[key] = el.checked;
        this.applySettings();
      });
    };
    toggle('opt-sound', 'sound');
    toggle('opt-bob', 'bobbing');
    toggle('opt-invert', 'invert');

    if (this.input.mode === 'touch') {
      $('key-help').hidden = true;
      $('touch-help').hidden = false;
    }
    this.input.bindTouchControls($('touch'), {
      fly: () => this.state === 'playing' && this.toggleFlight(),
      inventory: () => this.openInventory(),
      pause: () => this.pause(),
    });
  }

  applySettings() {
    setSoundEnabled(this.settings.sound);
    storage.set(SETTINGS_KEY, this.settings);
  }

  refreshTitle() {
    const typed = $('seed').value.trim();
    const sameWorld = !typed || typed === this.seedText;
    const play = $('btn-play');
    const fresh = $('btn-new');
    fresh.textContent = 'New world';
    this.confirmNew = false;
    if (this.hasSave && sameWorld) {
      play.textContent = 'Continue world';
      fresh.hidden = true;
    } else if (this.hasSave) {
      play.textContent = 'Continue world';
      fresh.hidden = false;
    } else {
      play.textContent = 'Create world';
      fresh.hidden = true;
    }
  }

  updateTitleStatus() {
    const s = this.spawn;
    const progress = this.streamer.progress(s.x, s.z, 3);
    const where = this.hasSave ? `Saved world <b>${escapeHtml(this.seedText)}</b>` : `Previewing seed <b>${escapeHtml(this.seedText)}</b>`;
    const html = progress < 1 ? `${where} · generating ${Math.round(progress * 100)}%` : `${where} · ${clockLabel(this.timeOfDay)}`;
    if (html !== this.lastTitleStatus) {
      $('title-status').innerHTML = html;
      this.lastTitleStatus = html;
    }
  }

  onPlayClicked() {
    const typed = $('seed').value.trim();
    if (this.hasSave) {
      // "Continue" always resumes the saved world, even if the seed box was edited.
      $('seed').value = this.seedText;
      this.play();
      return;
    }
    if (typed && typed !== this.seedText) this.openWorld(seedFromText(typed), typed, null);
    this.play();
    this.save();
  }

  onNewWorldClicked() {
    const btn = $('btn-new');
    if (this.hasSave && !this.confirmNew) {
      // Ask once inline; dialogs aren't available everywhere this runs.
      this.confirmNew = true;
      btn.textContent = 'Replace saved world?';
      btn.classList.add('warn');
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        this.confirmNew = false;
        btn.textContent = 'New world';
        btn.classList.remove('warn');
      }, 4000);
      return;
    }
    btn.classList.remove('warn');
    const typed = $('seed').value.trim() || randomSeedText();
    this.openWorld(seedFromText(typed), typed, null);
    this.play();
    this.save();
  }

  renderHotbar() {
    const bar = $('hotbar');
    bar.replaceChildren(...this.hotbar.map((id, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `slot${i === this.slot ? ' selected' : ''}`;
      b.title = BLOCKS[id].name;
      b.setAttribute('aria-label', `Slot ${i + 1}: ${BLOCKS[id].name}`);
      b.innerHTML = `<span class="num">${i + 1}</span><img alt="" src="${this.icon(id)}">`;
      b.addEventListener('click', () => this.selectSlot(i));
      return b;
    }));
  }

  buildInventory() {
    const grid = $('inv-grid');
    for (const block of BLOCKS) {
      if (block.hidden) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.title = block.name;
      b.setAttribute('aria-label', block.name);
      b.innerHTML = `<img alt="" src="${this.icon(block.id)}">`;
      b.addEventListener('click', () => {
        this.hotbar[this.slot] = block.id;
        this.renderHotbar();
        this.setItemInHand();
        this.showHeldName();
      });
      grid.appendChild(b);
    }
  }

  showHeldName() {
    const el = $('held-name');
    el.textContent = BLOCKS[this.hotbar[this.slot]].name;
    el.classList.remove('fade');
    clearTimeout(this.heldTimer);
    this.heldTimer = setTimeout(() => el.classList.add('fade'), 1400);
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('fade');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('fade'), 2600);
  }

  updateDebug(sky) {
    const p = this.player;
    const [x, y, z] = p.pos;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const deg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (−z)', 'east (+x)', 'south (+z)', 'west (−x)'][Math.round(deg / 90) % 4];
    const biome = BIOME_NAMES[this.world.terrain.columnInfo(bx, bz).biome];
    const t = this.target;
    const lines = [
      `Blockcraft · ${this.fps} fps`,
      `XYZ      ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block    ${bx} ${by} ${bz}   chunk ${Math.floor(bx / CHUNK)}, ${Math.floor(bz / CHUNK)}`,
      `Facing   ${facing}`,
      `Biome    ${biome}`,
      `Target   ${t ? `${BLOCKS[t.id].name} at ${t.x} ${t.y} ${t.z}` : '–'}`,
      `Chunks   ${this.renderer.stats.chunks} drawn · ${this.world.chunks.size} loaded · ${this.streamer.pendingJobs} jobs${this.streamer.inline ? ' (main thread)' : ''}`,
      `Faces    ${(this.renderer.stats.quads / 1000).toFixed(1)}k`,
      `Time     ${clockLabel(this.timeOfDay)} · light ${Math.round(sky.daylight * 100)}%`,
      `Mode     ${p.flying ? 'flying' : p.inWater ? 'swimming' : p.onGround ? 'walking' : 'falling'}`,
      `Seed     ${this.seedText}`,
    ];
    $('debug').textContent = lines.join('\n');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function start() {
  try {
    window.game = new Game();
    // When hosted somewhere that can hot-swap the page, save before the swap.
    window.claude?.hot?.snapshot?.(() => {
      window.game?.save();
      return {};
    });
  } catch (err) {
    console.error(err);
    $('title').hidden = true;
    $('fatal').hidden = false;
    $('fatal-text').textContent = err.message || String(err);
  }
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start();
