// App shell: world list and creation, settings, saving, input wiring and the
// frame loop. The simulation itself lives in game.js.
import { generateTextures, textureIndex } from './textures.js';
import { generateSkins } from './skins.js';
import { B, SELECTION } from './blocks.js';
import { ITEMS } from './items.js';
import { Streamer } from './streamer.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { createIconFactory, hudIcons } from './icons.js';
import { buildBlockItemMesh, buildSpriteMesh, buildOverlayMesh } from './mesher.js';
import { hashString } from './noise.js';
import { startAudio, setSoundEnabled } from './audio.js';
import { Game } from './game.js';
import { Hud } from './ui.js';

const INDEX_KEY = 'blockcraft:worlds';
const WORLD_KEY = (id) => `blockcraft:w:${id}`;
const OLD_KEY = 'blockcraft:world:v1';
const SETTINGS_KEY = 'blockcraft:settings:v1';
const AUTOSAVE_SECONDS = 30;
const SEED_WORDS = ['ember', 'quarry', 'meadow', 'basalt', 'harbor', 'thistle', 'canyon', 'lantern', 'willow', 'tundra', 'copper', 'glacier'];

// localStorage can be missing or throw (private windows, blocked storage, full quota).
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
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function timeAgo(t) {
  if (!t) return 'never played';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

class App {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
    this.settings = {
      renderDistance: this.isTouch ? 4 : 7,
      fov: 75,
      sensitivity: 1,
      sound: true,
      bobbing: true,
      invert: false,
      showGoal: true,
      debug: false,
      hideHud: false,
      ...storage.get(SETTINGS_KEY),
    };
    this.settings.debug = false;
    this.settings.hideHud = false;
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.textures = generateTextures();
    this.renderer.uploadTextures(this.textures);
    this.renderer.uploadSkins(generateSkins());
    this.icon = createIconFactory(this.textures);
    this.hudIcons = hudIcons();
    this.installMeshBuilders();
    this.streamer = new Streamer(this.renderer);
    this.game = new Game(this.renderer, this.streamer, this.textures);
    this.hud = new Hud(this);
    this.game.hud = this.hud;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.clock = 0;
    this.lastSpace = 0;
    this.everLocked = false;
    this.suppressPause = false;
    this.autosaveAt = AUTOSAVE_SECONDS;
    this.state = 'title';

    this.input = new Input(this.canvas, {
      onLook: (dx, dy) => this.look(dx, dy),
      onAction: (button, down) => this.onAction(button, down),
      onKey: (code, e) => this.onKey(code, e),
      onWheel: (dir) => this.game.selectSlot((this.game.selected + dir + 9) % 9),
      onLockChange: (locked) => this.onLockChange(locked),
      onLockError: () => this.onLockError(),
    });

    this.migrate();
    this.bindMenus();
    this.applySettings();
    this.selectWorld(this.worlds()[0]?.id ?? null);
    this.openPreview();
    this.renderWorldList();

    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // Item, arm and crack meshes are built on demand and cached by the renderer.
  installMeshBuilders() {
    const r = this.renderer;
    const armLayer = textureIndex('arm');
    r.itemMeshBuilder = (key) => {
      if (key === '__arm') return { ...buildOverlayMesh([[0.375, 0, 0.375, 0.625, 0.75, 0.625]], armLayer), translucent: false };
      if (key === 'fire_charge') return buildBlockItemMesh(B.LAVA);
      const item = ITEMS[key];
      if (!item) return null;
      if (item.layer < 0) return buildBlockItemMesh(item.displayId);
      const name = Object.keys(this.textures.tiles)[item.layer];
      return { ...buildSpriteMesh(item.layer, this.textures.tiles[name]), sprite: true };
    };
    r.overlayBuilder = (id, stage) => buildOverlayMesh(SELECTION[id]?.length ? SELECTION[id] : [[0, 0, 0, 1, 1, 1]], textureIndex(`destroy_${stage}`));
  }

  // ---------------------------------------------------------------- storage

  worlds() {
    const list = storage.get(INDEX_KEY);
    return Array.isArray(list) ? list.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)) : [];
  }

  setWorlds(list) {
    if (!storage.set(INDEX_KEY, list)) this.storageFailed = true;
  }

  // Bring a save from the first version of the game into the world list.
  migrate() {
    const old = storage.get(OLD_KEY);
    if (!old || typeof old.seed !== 'number') return;
    const id = `w${Date.now().toString(36)}`;
    const meta = { id, name: 'My first world', seed: old.seed, seedText: old.seedText ?? String(old.seed), mode: 'creative', cheats: true, difficulty: 'normal', created: Date.now(), lastPlayed: old.savedAt ?? Date.now() };
    const hotbar = Array.isArray(old.hotbar) ? old.hotbar : [];
    const keys = Object.keys(ITEMS);
    const save = {
      version: 2,
      dayTicks: Math.floor((old.time ?? 0) * 24000),
      player: { dim: 'overworld', mode: 'creative', pos: old.player?.pos ?? [0, 80, 0], yaw: old.player?.yaw ?? 0, pitch: old.player?.pitch ?? 0, flying: !!old.player?.flying, selected: old.slot ?? 0 },
      inventory: { main: hotbar.map((bid) => { const k = keys.find((key) => ITEMS[key].blockId === bid); return k ? { item: k, count: 64, damage: 0 } : null; }) },
      worldSpawn: old.spawn ?? null,
      dims: { overworld: { edits: old.edits ?? {} } },
    };
    if (storage.set(WORLD_KEY(id), save)) {
      this.setWorlds([meta, ...this.worlds()]);
      storage.remove(OLD_KEY);
    }
  }

  save() {
    const game = this.game;
    if (!this.current || game.state === 'title') return false;
    const data = game.serialize();
    const ok = storage.set(WORLD_KEY(this.current.id), data);
    const list = this.worlds().map((w) => (w.id === this.current.id ? { ...w, lastPlayed: Date.now() } : w));
    this.setWorlds(list);
    this.lastSaveOk = ok;
    if (!ok && !this.warnedSave) {
      this.warnedSave = true;
      this.hud.toast('Saving failed: this browser blocked storage or it is full');
    }
    return ok;
  }

  // ---------------------------------------------------------------- worlds & menus

  selectWorld(id) {
    this.selectedId = id;
    this.renderWorldList();
  }

  renderWorldList() {
    const list = this.worlds();
    const box = $('world-list');
    if (!list.length) {
      box.innerHTML = '<p class="hint">No worlds yet. Create one to start.</p>';
      $('btn-play').disabled = true;
      return;
    }
    $('btn-play').disabled = !this.selectedId;
    box.innerHTML = list.map((w) => `
      <div class="world" role="option" data-id="${w.id}" aria-selected="${w.id === this.selectedId}" tabindex="0">
        <b>${escapeHtml(w.name)}</b>
        <small>${w.mode === 'creative' ? 'Creative' : `Survival · ${w.difficulty ?? 'normal'}`} · seed ${escapeHtml(w.seedText)} · ${timeAgo(w.lastPlayed)}</small>
        <button class="btn small" type="button" data-delete="${w.id}">${this.confirmDelete === w.id ? 'Really delete?' : 'Delete'}</button>
      </div>`).join('');
    box.querySelectorAll('.world').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.dataset.delete) return;
        if (this.selectedId === el.dataset.id && e.detail === 2) {
          this.play();
          return;
        }
        this.selectWorld(el.dataset.id);
        this.openPreview();
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.selectWorld(el.dataset.id); this.play(); } });
    });
    box.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => this.deleteWorld(b.dataset.delete)));
  }

  deleteWorld(id) {
    if (this.confirmDelete !== id) {
      // Ask once inline; dialogs aren't available everywhere this runs.
      this.confirmDelete = id;
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => { this.confirmDelete = null; this.renderWorldList(); }, 4000);
      this.renderWorldList();
      return;
    }
    this.confirmDelete = null;
    storage.remove(WORLD_KEY(id));
    this.setWorlds(this.worlds().filter((w) => w.id !== id));
    if (this.current?.id === id) this.current = null;
    this.selectWorld(this.worlds()[0]?.id ?? null);
    this.openPreview();
  }

  // Load the selected world behind the title screen (or a fresh one to look at).
  openPreview() {
    const meta = this.worlds().find((w) => w.id === this.selectedId);
    if (meta) {
      if (this.current?.id === meta.id) return;
      this.current = meta;
      this.game.open(meta, storage.get(WORLD_KEY(meta.id)));
    } else if (!this.previewMeta) {
      const text = randomSeedText();
      this.previewMeta = { id: null, name: 'Preview', seed: seedFromText(text), seedText: text, mode: 'survival' };
      this.current = null;
      this.game.open(this.previewMeta, null);
    }
    this.game.state = 'title';
    this.titleY = null;
  }

  createWorld() {
    const name = $('world-name').value.trim() || 'New World';
    const seedText = $('seed').value.trim() || randomSeedText();
    const mode = document.querySelector('#mode-choices [aria-pressed="true"]').dataset.mode;
    const difficulty = document.querySelector('#diff-choices [aria-pressed="true"]').dataset.diff;
    const meta = {
      id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
      name,
      seed: seedFromText(seedText),
      seedText,
      mode,
      cheats: $('opt-cheats').checked,
      difficulty,
      created: Date.now(),
      lastPlayed: Date.now(),
    };
    this.setWorlds([meta, ...this.worlds()]);
    this.current = meta;
    this.selectedId = meta.id;
    this.game.open(meta, null);
    $('create').hidden = true;
    this.play();
  }

  bindMenus() {
    $('btn-play').addEventListener('click', () => this.play());
    $('btn-create').addEventListener('click', () => {
      $('title').hidden = true;
      $('create').hidden = false;
      $('world-name').value = `World ${this.worlds().length + 1}`;
      $('seed').value = randomSeedText();
      $('world-name').focus();
    });
    $('btn-create-cancel').addEventListener('click', () => {
      $('create').hidden = true;
      $('title').hidden = false;
    });
    $('btn-create-go').addEventListener('click', () => this.createWorld());
    $('seed-shuffle').addEventListener('click', () => { $('seed').value = randomSeedText(); });
    for (const input of [$('world-name'), $('seed')]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.createWorld(); });
    const choose = (group, attr, onPick) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        onPick?.(b.dataset[attr]);
      }));
    };
    choose($('mode-choices'), 'mode', (mode) => {
      $('mode-hint').textContent = mode === 'creative'
        ? 'Unlimited blocks, instant breaking, flight, and no damage. Build anything.'
        : 'Gather resources, craft tools, eat to stay alive, and work toward the Ender Dragon.';
    });
    choose($('diff-choices'), 'diff');
    $('pause-diff').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.game.difficulty = b.dataset.diff;
      this.renderPauseDifficulty();
    }));

    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-quit').addEventListener('click', () => this.quitToTitle());
    $('btn-adv').addEventListener('click', () => this.openAdvancements());
    $('adv-close').addEventListener('click', () => this.closeAdvancements());
    $('btn-respawn').addEventListener('click', () => {
      this.hud.hideDeath();
      this.game.respawn();
      this.resume();
    });
    $('btn-death-title').addEventListener('click', () => {
      this.hud.hideDeath();
      this.game.respawn();
      this.quitToTitle();
    });
    $('btn-credits-done').addEventListener('click', () => {
      $('credits').hidden = true;
      this.game.returnFromEnd();
      this.resume();
    });
    // After a refused or lost pointer lock, a click on the world takes it back.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && this.input.mode === 'lock' && !this.input.locked) this.input.requestLock();
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
    range('opt-distance', 'renderDistance', (v) => `${v} chunks · ${v * 16} blocks`);
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
    toggle('opt-goal', 'showGoal');

    if (this.input.mode === 'touch') {
      $('key-help').hidden = true;
      $('touch-help').hidden = false;
    }
    this.input.bindTouchControls($('touch'), {
      fly: () => this.toggleFlight(),
      inventory: () => this.openInventory(),
      pause: () => this.pause(),
      drop: () => this.game.dropFromHand(false),
      chat: () => this.openChat(''),
    });
  }

  applySettings() {
    setSoundEnabled(this.settings.sound);
    const { debug, hideHud, ...persist } = this.settings;
    void debug; void hideHud;
    storage.set(SETTINGS_KEY, persist);
  }

  renderPauseDifficulty() {
    $('pause-diff').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diff === this.game.difficulty)));
  }

  // ---------------------------------------------------------------- states

  play() {
    if (!this.current) {
      const meta = this.worlds().find((w) => w.id === this.selectedId);
      if (!meta) return;
      this.current = meta;
      this.game.open(meta, storage.get(WORLD_KEY(meta.id)));
    }
    if (this.current.id !== this.selectedId && this.selectedId) {
      const meta = this.worlds().find((w) => w.id === this.selectedId);
      this.current = meta;
      this.game.open(meta, storage.get(WORLD_KEY(meta.id)));
    }
    $('title').hidden = true;
    $('create').hidden = true;
    this.hud.refreshHotbar();
    this.resume();
    this.hud.chat([{ text: `Welcome to ${this.current.name}. Press T for chat, /help for commands, L for your goals.` }]);
  }

  resume() {
    startAudio();
    this.state = 'playing';
    if (this.game.state !== 'dead' && this.game.state !== 'sleeping') this.game.state = 'playing';
    for (const id of ['title', 'pause', 'advancements', 'create']) $(id).hidden = true;
    $('hud').hidden = this.settings.hideHud;
    $('touch').hidden = this.input.mode !== 'touch';
    if (this.input.mode === 'lock') this.input.requestLock();
    this.updateResumeHint();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.game.held = { 0: false, 2: false };
    if (this.game.state === 'playing') this.game.state = 'paused';
    this.save();
    $('pause').hidden = false;
    $('touch').hidden = true;
    $('resume-hint').hidden = true;
    this.input.releaseLock();
    this.renderPauseDifficulty();
    const g = this.game;
    $('pause-status').innerHTML = `${escapeHtml(this.current?.name ?? '')} · seed <b>${escapeHtml(g.seedText)}</b> · ${g.player.mode} · day ${Math.floor(g.dayTicks / 24000) + 1}${this.lastSaveOk === false ? ' · <b>Saving is unavailable in this browser</b>' : ' · Saved'}`;
  }

  quitToTitle() {
    this.save();
    this.hud.closeScreen(false);
    this.state = 'title';
    this.game.state = 'title';
    this.input.releaseLock();
    for (const id of ['pause', 'hud', 'touch', 'loading', 'advancements', 'death', 'credits', 'chat-input-row']) $(id).hidden = true;
    $('title').hidden = false;
    this.selectedId = this.current?.id ?? this.selectedId;
    this.renderWorldList();
  }

  openInventory() {
    if (this.state !== 'playing' || this.game.state !== 'playing' || this.game.player.dead) return;
    this.game.openScreen('inventory', null);
  }

  // A game window or the chat took over the mouse.
  onWindowOpened() {
    this.state = 'window';
    this.game.state = 'screen';
    this.suppressPause = true;
    this.input.releaseLock();
    $('touch').hidden = true;
    $('resume-hint').hidden = true;
  }

  onWindowClosed() {
    this.resume();
  }

  openChat(prefix) {
    if (this.state !== 'playing') return;
    this.state = 'chat';
    this.suppressPause = true;
    this.input.releaseLock();
    this.hud.openChat(prefix);
  }

  onChatClosed() {
    if (this.state === 'chat') this.resume();
  }

  openAdvancements() {
    this.hud.renderAdvancements();
    $('advancements').hidden = false;
    $('pause').hidden = true;
    if (this.state === 'playing') {
      this.state = 'advancements';
      this.suppressPause = true;
      this.input.releaseLock();
    }
  }

  closeAdvancements() {
    $('advancements').hidden = true;
    if (this.state === 'advancements') this.resume();
    else $('pause').hidden = false;
  }

  onDeath() {
    this.state = 'dead';
    this.suppressPause = true;
    this.input.releaseLock();
    $('touch').hidden = true;
    this.save();
  }

  onCredits() {
    this.state = 'credits';
    this.suppressPause = true;
    this.input.releaseLock();
    $('touch').hidden = true;
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
    // Chrome refuses a re-lock for about a second after Esc; only give up on
    // the mouse if it never worked.
    if (!this.everLocked && this.input.mode === 'lock') {
      this.input.useDragMode();
      this.hud.toast('Drag to look around. Click to mine or attack, right-click to use.');
    }
    this.updateResumeHint();
  }

  updateResumeHint() {
    $('resume-hint').hidden = !(this.state === 'playing' && this.input.mode === 'lock' && !this.input.locked);
  }

  // ---------------------------------------------------------------- input

  look(dx, dy) {
    if (this.state !== 'playing' || this.game.player.dead || this.game.state === 'sleeping') return;
    const k = 0.0023 * this.settings.sensitivity;
    const p = this.game.player;
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
    this.game.onAction(button, down);
  }

  toggleFlight() {
    const p = this.game.player;
    if (this.state !== 'playing' || (!p.creative && !p.spectator)) return;
    p.flying = !p.flying;
    if (p.flying) p.vel[1] = Math.max(p.vel[1], 2);
    this.hud.toast(p.flying ? 'Flying. Space to rise, Shift to sink.' : 'Flying off');
  }

  onKey(code, e) {
    const game = this.game;
    if (this.state === 'window') {
      if (code === 'Escape' || code === 'KeyE') {
        this.hud.closeScreen();
        return true;
      }
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5)) - 1;
        if (n >= 0 && n < 9) return this.hud.hotkeySwap(n);
      }
      return false;
    }
    if (this.state === 'advancements') {
      if (code === 'Escape' || code === 'KeyL') { this.closeAdvancements(); return true; }
      return false;
    }
    if (code === 'Escape') {
      if (this.state === 'playing' && this.input.mode !== 'lock') { this.pause(); return true; }
      if (this.state === 'paused' && this.input.mode !== 'lock') { this.resume(); return true; }
      return false;
    }
    if (this.state !== 'playing' || game.state !== 'playing') return false;
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) {
        game.selectSlot(n - 1);
        return true;
      }
    }
    switch (code) {
      case 'KeyE': this.openInventory(); return true;
      case 'KeyQ': game.dropFromHand(e.ctrlKey || e.metaKey); return true;
      case 'KeyT': this.openChat(''); return true;
      case 'Slash': this.openChat('/'); return true;
      case 'KeyL': this.openAdvancements(); return true;
      case 'KeyF': this.toggleFlight(); return true;
      case 'F3':
        this.settings.debug = !this.settings.debug;
        $('debug').hidden = !this.settings.debug;
        return true;
      case 'F1':
        this.settings.hideHud = !this.settings.hideHud;
        $('hud').hidden = this.settings.hideHud;
        return true;
      case 'Space':
        if (!e.repeat) {
          if (this.clock - this.lastSpace < 0.3) {
            this.toggleFlight();
            this.lastSpace = 0;
          } else {
            this.lastSpace = this.clock;
          }
        }
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- loop

  titleCamera() {
    const game = this.game;
    const s = game.worldSpawn ?? { x: 0, y: 70, z: 0 };
    const a = this.clock * 0.035 + 0.6;
    const r = 34;
    const x = s.x + Math.cos(a) * r;
    const z = s.z + Math.sin(a) * r;
    const world = game.world;
    const ground = Math.max(world.terrain.columnInfo(x, z).h, world.surfaceY(Math.floor(x), Math.floor(z)));
    const wantY = Math.max(s.y + 22, ground + 12);
    this.titleY = this.titleY == null ? wantY : this.titleY + (wantY - this.titleY) * 0.02;
    const cam = [x, this.titleY, z];
    const d = [s.x - x, s.y + 2 - cam[1], s.z - z];
    const len = Math.hypot(d[0], d[1], d[2]);
    return { cam, yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / len) };
  }

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - (this.last ?? now)) / 1000));
    this.last = now;
    this.clock += dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const game = this.game;
    try {
      let titleCam = null;
      if (this.state === 'title' || this.state === 'create') {
        titleCam = this.titleCamera();
        game.particles.update(dt, game.world);
        if (game.world.dimension === 'overworld' && game.gamerules.doDaylightCycle) game.dayTicks += dt * 20;
      } else if (this.state !== 'paused') {
        const move = this.state === 'playing' ? this.input.movement() : { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
        game.frame(dt, move);
        this.autosaveAt -= dt;
        if (this.autosaveAt <= 0) {
          this.autosaveAt = AUTOSAVE_SECONDS;
          this.save();
        }
      }
      const view = game.view(this.settings, titleCam);
      this.streamer.update(view.cam[0], view.cam[2], this.settings.renderDistance);
      this.renderer.render(view);
      if (this.state !== 'title') this.hud.update(game, this.settings);
      else this.updateTitleStatus();
    } catch (err) {
      console.error(err);
      if (!this.reportedError) {
        this.reportedError = true;
        this.hud.toast(`Something went wrong: ${err.message}`);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  updateTitleStatus() {
    const g = this.game;
    const s = g.worldSpawn ?? { x: 0, z: 0 };
    const progress = this.streamer.progress(s.x, s.z, 3);
    const where = this.current ? `<b>${escapeHtml(this.current.name)}</b>` : `Previewing seed <b>${escapeHtml(g.seedText)}</b>`;
    const html = progress < 1 ? `${where} · loading ${Math.round(progress * 100)}%` : where;
    if (html !== this.lastTitleStatus) {
      $('title-status').innerHTML = html;
      this.lastTitleStatus = html;
    }
  }
}

try {
  window.app = new App();
} catch (err) {
  console.error(err);
  $('title').hidden = true;
  $('fatal').hidden = false;
  $('fatal-text').textContent = err.message || String(err);
}
