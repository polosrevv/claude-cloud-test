// The DOM side of play: HUD (hotbar, hearts, hunger, chat, toasts, boss bar),
// game windows (inventory, crafting table, furnace, chest, creative picker),
// death screen, credits and advancements.
import { ITEMS, ITEM_ORDER, CREATIVE_TABS, maxStack } from './items.js';
import { Inventory, clickSlot, quickMove, craftingResult, takeCraft, SMELT_TICKS } from './inventory.js';
import { SMELTING } from './recipes.js';
import { ADVANCEMENTS } from './advancements.js';
import { runCommand, complete } from './commands.js';
import { BIOME_NAMES } from './terrain.js';
import { clockLabel } from './sky.js';
import { BLOCKS } from './blocks.js';
import { describe, enchantName } from './enchantments.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// An enchanted item's moving sheen, masked to the icon's shape.
function glint(stack, src) {
  return stack.ench ? `<span class="glint" style="--icon:url('${src}')"></span>` : '';
}

function durabilityBar(stack) {
  const max = ITEMS[stack.item]?.durability;
  if (!max || !stack.damage) return '';
  const left = Math.max(0, 1 - stack.damage / max);
  const hue = Math.round(left * 120);
  return `<span class="dur"><i style="width:${Math.round(left * 100)}%;background:hsl(${hue} 90% 45%)"></i></span>`;
}

export class Hud {
  constructor(app) {
    this.app = app;
    this.icon = app.icon;
    this.icons = app.hudIcons;
    this.chatLog = [];
    this.history = [];
    this.historyIndex = -1;
    this.lastStats = '';
    this.window = null;
    this.creativeTab = 'blocks';
    this.search = '';
    this.bindChat();
    this.bindWindowPointer();
  }

  get game() {
    return this.app.game;
  }

  // ---------------------------------------------------------------- HUD

  refreshHotbar(selectionChanged = false) {
    const game = this.game;
    const bar = $('hotbar');
    const slots = game.inventory.main.slots;
    const els = [];
    for (let i = 0; i < 9; i++) {
      const s = slots[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hslot${i === game.selected ? ' selected' : ''}`;
      b.setAttribute('aria-label', s ? `Slot ${i + 1}: ${ITEMS[s.item].name}${s.count > 1 ? ` x${s.count}` : ''}` : `Slot ${i + 1}: empty`);
      b.innerHTML = s ? `<img alt="" src="${this.icon(s.item)}">${glint(s, this.icon(s.item))}${s.count > 1 ? `<span class="n">${s.count}</span>` : ''}${durabilityBar(s)}` : '';
      b.addEventListener('click', () => game.selectSlot(i));
      els.push(b);
    }
    bar.replaceChildren(...els);
    if (selectionChanged) this.showHeldName();
    if (this.window) this.renderWindow();
  }

  showHeldName() {
    const s = this.game.heldStack();
    const el = $('held-name');
    el.textContent = s ? [ITEMS[s.item].name, ...describe(s)].join(' · ') : '';
    el.classList.remove('fade');
    clearTimeout(this.heldTimer);
    this.heldTimer = setTimeout(() => el.classList.add('fade'), 1400);
  }

  // Per-frame HUD refresh; rebuilds the bars only when a value changes.
  update(game, settings) {
    const p = game.player;
    const survival = p.vulnerable;
    const air = Math.max(0, Math.ceil(p.air / 30));
    const key = `${survival}|${Math.ceil(p.health)}|${p.food}|${game.armorPoints()}|${p.headInWater || p.air < 300 ? air : -1}`;
    if (key !== this.lastStats) {
      this.lastStats = key;
      $('stats').hidden = !survival;
      if (survival) {
        const row = (el, value, full, half, empty, max = 20) => {
          const parts = [];
          for (let i = 0; i < max / 2; i++) {
            const v = value - i * 2;
            parts.push(`<img alt="" src="${v >= 2 ? full : v === 1 ? half : empty}">`);
          }
          el.innerHTML = parts.join('');
        };
        row($('health-bar'), Math.ceil(p.health), this.icons.heart, this.icons.heartHalf, this.icons.heartEmpty);
        row($('food-bar'), p.food, this.icons.food, this.icons.foodHalf, this.icons.foodEmpty);
        const armor = game.armorPoints();
        if (armor > 0) row($('armor-bar'), armor, this.icons.armor, this.icons.armorHalf, this.icons.armorEmpty);
        else $('armor-bar').innerHTML = '';
        $('air-bar').innerHTML = p.headInWater || p.air < 300 ? Array.from({ length: air }, () => `<img alt="" src="${this.icons.bubble}">`).join('') : '';
      }
    }
    const xpKey = survival ? `${p.xpLevel}|${Math.round(p.xpProgress * 182)}` : '';
    if (xpKey !== this.lastXp) {
      this.lastXp = xpKey;
      $('xp').hidden = !survival;
      $('xp-fill').style.width = `${Math.round(p.xpProgress * 1000) / 10}%`;
      $('xp-level').textContent = p.xpLevel > 0 ? String(p.xpLevel) : '';
    }
    $('underwater').hidden = !(p.headInWater && !p.dead);
    $('fire-tint').hidden = !(p.fireTicks > 0 && survival && !p.dead);
    $('hurt-tint').style.opacity = p.hurtTicks > 0 ? String(p.hurtTicks / 10) : '0';
    if (settings.debug) this.updateDebug(game);
    const goal = $('goal');
    const next = game.advancements.next();
    goal.hidden = !settings.showGoal || !next || game.state !== 'playing';
    if (!goal.hidden) {
      const html = `<b>Next: ${escapeHtml(next.title)}</b>${escapeHtml(next.about)}`;
      if (goal.dataset.html !== html) {
        goal.innerHTML = html;
        goal.dataset.html = html;
      }
    }
    // Chat lines fade after ten seconds unless the chat box is open.
    const open = !$('chat-input-row').hidden;
    const now = performance.now();
    for (const line of this.chatLog) line.el.style.opacity = open || now - line.at < 10000 ? '1' : '0';
  }

  updateDebug(game) {
    const p = game.player;
    const [x, y, z] = p.pos;
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const deg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (−z)', 'east (+x)', 'south (+z)', 'west (−x)'][Math.round(deg / 90) % 4];
    const light = game.world.getLight(bx, by, bz);
    const t = game.target;
    const r = this.app.renderer.stats;
    const lines = [
      `Blockcraft · ${this.app.fps} fps · ${game.world.info.name}`,
      `XYZ      ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`,
      `Block    ${bx} ${by} ${bz}   chunk ${Math.floor(bx / 16)}, ${Math.floor(bz / 16)}`,
      `Facing   ${facing}`,
      `Biome    ${game.world.terrain.biomeName?.(bx, bz) ?? ''}`,
      `Light    sky ${light >> 4} · block ${light & 15}`,
      `Target   ${t ? (t.entity ? (t.entity.def?.name ?? t.entity.kind) : `${BLOCKS[t.id].name} at ${t.x} ${t.y} ${t.z}`) : '–'}`,
      `Chunks   ${r.chunks} drawn · ${game.world.chunks.size} loaded · ${this.app.streamer.pendingJobs} jobs`,
      `Entities ${game.entities.list.length} (${r.entities} drawn) · faces ${(r.quads / 1000).toFixed(1)}k`,
      `Time     ${clockLabel(game.timeOfDay)} · day ${Math.floor(game.dayTicks / 24000) + 1} · ${game.difficulty}`,
      `Weather  ${game.weather.state.raining ? (game.weather.state.thundering ? 'thunderstorm' : 'rain') : 'clear'} · next change in ${Math.ceil(game.weather.state.rainTime / 1200)} min`,
      `Mode     ${p.mode}${p.flying ? ' · flying' : ''}`,
      `Seed     ${game.seedText}`,
    ];
    void BIOME_NAMES;
    $('debug').textContent = lines.join('\n');
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('fade');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('fade'), 2800);
  }

  chat(lines) {
    const box = $('chat');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line.text;
      if (line.kind) p.className = line.kind;
      box.appendChild(p);
      this.chatLog.push({ el: p, at: performance.now() });
    }
    while (this.chatLog.length > 12) this.chatLog.shift().el.remove();
  }

  advancement(a) {
    const el = $('advancement');
    const item = a.has?.[0] ?? { kill: 'iron_sword', enchant: 'enchanting_table', sleep: 'bed', nether: 'obsidian', fortress: 'nether_bricks', stronghold: 'eye_of_ender', end: 'end_stone', dragon: 'dragon_egg' }[a.event] ?? 'iron_armor';
    $('adv-icon').src = this.icon(ITEMS[item] ? item : 'grass');
    $('adv-title').textContent = a.title;
    el.classList.remove('out');
    clearTimeout(this.advTimer);
    this.advTimer = setTimeout(() => el.classList.add('out'), 4500);
    this.chat([{ text: `You have made the advancement [${a.title}]`, kind: 'achieved' }]);
  }

  bossBar(name, fraction = 1) {
    const el = $('bossbar');
    if (!name) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    el.hidden = false;
    $('boss-name').textContent = name;
    $('boss-fill').style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  loading(progress) {
    const el = $('loading');
    if (progress === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    $('loading-bar').style.width = `${Math.round(progress * 100)}%`;
  }

  overlay(kind, amount) {
    if (kind === 'portal') $('portal-tint').style.opacity = String(amount * 0.9);
  }

  sleep(amount) {
    $('sleep-tint').style.opacity = amount === null ? '0' : String(amount);
  }

  showDeath(message) {
    this.closeScreen(false);
    $('death-message').textContent = message;
    $('death').hidden = false;
    this.app.onDeath();
  }

  hideDeath() {
    $('death').hidden = true;
  }

  showCredits(stats) {
    this.closeScreen(false);
    const minutes = Math.floor(stats.playTicks / 20 / 60);
    $('credit-stats').innerHTML = [
      ['Time played', `${Math.floor(minutes / 60)} h ${minutes % 60} min`],
      ['Blocks mined', stats.blocksMined],
      ['Blocks placed', stats.blocksPlaced],
      ['Mobs killed', stats.mobsKilled],
      ['Deaths', stats.deaths],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('credits').hidden = false;
    this.app.onCredits();
  }

  // ---------------------------------------------------------------- chat input

  bindChat() {
    const input = $('chat-input');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        this.sendChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      } else if (e.key === 'ArrowUp') {
        if (this.history.length) {
          this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
          input.value = this.history[this.history.length - 1 - this.historyIndex];
        }
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.historyIndex = Math.max(-1, this.historyIndex - 1);
        input.value = this.historyIndex >= 0 ? this.history[this.history.length - 1 - this.historyIndex] : '';
        e.preventDefault();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const options = complete(input.value);
        if (options.length === 1) input.value = `${options[0]} `;
        else if (options.length > 1) this.chat([{ text: options.slice(0, 20).join('  ') }]);
      }
    });
    $('chat-send').addEventListener('click', () => this.sendChat());
  }

  openChat(prefix = '') {
    $('chat-input-row').hidden = false;
    const input = $('chat-input');
    input.value = prefix;
    this.historyIndex = -1;
    setTimeout(() => input.focus(), 0);
  }

  closeChat() {
    $('chat-input-row').hidden = true;
    $('chat-input').blur();
    this.app.onChatClosed();
  }

  get chatOpen() {
    return !$('chat-input-row').hidden;
  }

  sendChat() {
    const text = $('chat-input').value.trim();
    if (text) {
      this.history.push(text);
      if (text.startsWith('/')) this.chat(runCommand(this.game, text));
      else this.chat([{ text: `<You> ${text}` }]);
    }
    this.closeChat();
  }

  // ---------------------------------------------------------------- windows

  openScreen(kind, data) {
    const game = this.game;
    if (kind === 'inventory' && game.player.creative) kind = 'creative';
    this.window = { kind, data, grid: kind === 'crafting' ? new Inventory(9) : null };
    $('window').hidden = false;
    this.renderWindow();
    this.app.onWindowOpened();
  }

  get windowOpen() {
    return !!this.window;
  }

  // Close the window: whatever is on the cursor or in a crafting grid goes back to the inventory.
  closeScreen(notify = true) {
    if (!this.window) return;
    const game = this.game;
    const inv = game.inventory;
    const returns = [];
    if (inv.cursor) returns.push(inv.cursor);
    inv.cursor = null;
    const grid = this.window.kind === 'crafting' ? this.window.grid : inv.craft;
    for (let i = 0; i < grid.slots.length; i++) {
      if (grid.slots[i]) returns.push(grid.slots[i]);
      grid.slots[i] = null;
    }
    // The enchanting table holds nothing once you walk away.
    if (this.window.kind === 'enchant') {
      for (const s of this.window.data.slots) if (s) returns.push(s);
      this.window.data.slots = [null, null];
    }
    for (const s of returns) {
      const left = inv.give(s);
      if (left) game.throwStack({ ...s, count: left });
    }
    this.window = null;
    game.openContainer = null;
    $('window').hidden = true;
    $('cursor-stack').hidden = true;
    $('tooltip').hidden = true;
    this.refreshHotbar();
    if (notify) this.app.onWindowClosed();
  }

  refreshScreen() {
    if (this.window) this.renderWindow();
  }

  slotHtml(stack, ghost = false) {
    if (!stack) return '';
    const src = this.icon(stack.item);
    return `<img alt="" src="${src}"${ghost ? ' class="ghost"' : ''}>${glint(stack, src)}${stack.count > 1 ? `<span class="n">${stack.count}</span>` : ''}${durabilityBar(stack)}`;
  }

  // Builds the window markup and a table of slot references for clicks.
  renderWindow() {
    const w = this.window;
    const game = this.game;
    const inv = game.inventory;
    const refs = [];
    const slot = (ref, cls = '') => {
      refs.push(ref);
      const s = ref.preview ?? ref.inv.slots[ref.index];
      const label = s ? `${ITEMS[s.item].name}${s.count > 1 ? ` x${s.count}` : ''}` : ref.empty ?? 'Empty slot';
      return `<div class="slot ${cls}" data-ref="${refs.length - 1}" role="button" tabindex="0" aria-label="${escapeHtml(label)}">${this.slotHtml(s, ref.ghost)}</div>`;
    };
    const grid = (cols, content) => `<div class="grid" style="--cols:${cols}">${content}</div>`;
    const range = (invObj, from, to, kind, section) => {
      let h = '';
      for (let i = from; i < to; i++) h += slot({ inv: invObj, index: i, kind, section });
      return h;
    };
    const player = () => `
      ${grid(9, range(inv.main, 9, 36, 'normal', 'main'))}
      ${grid(9, range(inv.main, 0, 9, 'normal', 'hotbar'))}`;
    let body = '';
    let title = '';
    if (w.kind === 'inventory') {
      title = 'Inventory';
      const result = craftingResult(inv.craft, 2);
      const armor = ['Helmet', 'Chestplate', 'Leggings', 'Boots'].map((n, i) => slot({ inv: inv.armor, index: i, kind: 'armor', armorSlot: i, section: 'armor', empty: `${n} slot` })).join('');
      const next = game.advancements.next();
      body = `
        <div class="gui-row">
          <div class="grid" style="--cols:1">${armor}</div>
          <div class="side-note">${next ? `<b>Next goal: ${escapeHtml(next.title)}</b><br>${escapeHtml(next.about)}` : '<b>Every advancement done.</b>'}</div>
          <div class="gui-row" style="gap:8px">
            ${grid(2, range(inv.craft, 0, 4, 'normal', 'craft'))}
            <div class="arrow">→</div>
            ${slot({ inv: { slots: [result ? { item: result.item, count: result.count } : null] }, index: 0, kind: 'craft-result', grid: inv.craft, size: 2, section: 'result' }, 'big')}
          </div>
        </div>
        ${player()}`;
    } else if (w.kind === 'crafting') {
      title = 'Crafting';
      const result = craftingResult(w.grid, 3);
      body = `
        <div class="gui-row" style="justify-content:center">
          ${grid(3, range(w.grid, 0, 9, 'normal', 'craft'))}
          <div class="arrow">→</div>
          ${slot({ inv: { slots: [result ? { item: result.item, count: result.count } : null] }, index: 0, kind: 'craft-result', grid: w.grid, size: 3, section: 'result' }, 'big')}
        </div>
        ${player()}`;
    } else if (w.kind === 'furnace') {
      title = 'Furnace';
      const f = w.data;
      const fInv = { slots: f.slots };
      const cook = Math.round((f.cook / SMELT_TICKS) * 100);
      const burn = f.burnMax ? Math.round((f.burn / f.burnMax) * 100) : 0;
      body = `
        <div class="gui-row" style="justify-content:center">
          <div class="stack-col">
            ${slot({ inv: fInv, index: 0, kind: 'normal', section: 'input', empty: 'Item to smelt' })}
            <div class="flame"><i style="height:${burn}%"></i></div>
            ${slot({ inv: fInv, index: 1, kind: 'fuel', section: 'fuel', empty: 'Fuel' })}
          </div>
          <div class="arrow">→<i style="width:${cook}%">→</i></div>
          ${slot({ inv: fInv, index: 2, kind: 'result', section: 'output' }, 'big')}
        </div>
        ${player()}`;
    } else if (w.kind === 'enchant') {
      title = 'Enchant';
      const table = w.data;
      const tInv = { slots: table.slots };
      const p = game.player;
      const lapis = table.slots[1]?.item === 'lapis_lazuli' ? table.slots[1].count : 0;
      const offers = game.enchantOffersFor(table);
      const rows = offers.map((o, i) => {
        if (!o) return '<button type="button" class="ench-offer" disabled><span></span><span class="ench-name"></span><span></span></button>';
        const can = !p.vulnerable || (p.xpLevel >= o.cost && lapis >= o.lapis);
        const why = !can ? (p.xpLevel < o.cost ? `Needs level ${o.cost}` : `Needs ${o.lapis} lapis lazuli`) : `Costs ${o.lapis} level${o.lapis > 1 ? 's' : ''} and ${o.lapis} lapis`;
        return `<button type="button" class="ench-offer" data-offer="${i}"${can ? '' : ' aria-disabled="true"'} title="${escapeHtml(why)}">
          <span class="ench-lapis" aria-hidden="true">${'◆'.repeat(o.lapis)}</span>
          <span class="ench-name">${escapeHtml(enchantName(o.hint.key, o.hint.level))}${o.ench.length > 1 ? ' . . . ?' : ''}</span>
          <span class="ench-cost">${o.cost}</span>
        </button>`;
      }).join('');
      const shelves = game.countBookshelves(table);
      body = `
        <div class="gui-row" style="justify-content:center;align-items:flex-start">
          <div class="stack-col">
            ${slot({ inv: tInv, index: 0, kind: 'enchant-item', section: 'enchant', empty: 'Item to enchant' })}
            ${slot({ inv: tInv, index: 1, kind: 'lapis', section: 'lapis', empty: 'Lapis lazuli' })}
          </div>
          <div class="ench-offers">${rows}</div>
        </div>
        <div class="side-note" style="max-width:none">Your level: <b>${p.vulnerable ? p.xpLevel : '∞'}</b> · Bookshelves: <b>${shelves}</b>/15. Bookshelves two blocks from the table make stronger offers.</div>
        ${player()}`;
    } else if (w.kind === 'chest') {
      title = 'Chest';
      body = `${grid(9, range({ slots: w.data.slots }, 0, 27, 'normal', 'chest'))}${player()}`;
    } else if (w.kind === 'creative') {
      title = 'Creative';
      const tabs = [...CREATIVE_TABS, ['search', 'Search']].map(([id, name]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.creativeTab === id}">${name}</button>`).join('');
      const q = this.search.toLowerCase();
      const items = ITEM_ORDER.filter((k) => (this.creativeTab === 'search' ? ITEMS[k].name.toLowerCase().includes(q) : ITEMS[k].tab === this.creativeTab));
      const cells = items.map((k) => slot({ creative: k, inv: { slots: [{ item: k, count: 1 }] }, index: 0, kind: 'creative', section: 'creative' })).join('');
      body = `
        <div class="tabs" role="tablist">${tabs}</div>
        ${this.creativeTab === 'search' ? `<input id="creative-search" type="text" placeholder="Search items" value="${escapeHtml(this.search)}" aria-label="Search items">` : ''}
        <div class="creative-grid">${grid(9, cells)}</div>
        ${grid(9, range(inv.main, 0, 9, 'normal', 'hotbar'))}
        <div class="hint" style="color:#3a3a3a">Click an item to pick up a stack. Click it into the hotbar. Shift-click sends it straight there.</div>`;
    }
    const el = $('window');
    el.innerHTML = `<div class="gui" role="dialog" aria-label="${title}"><div class="gui-head"><span class="gui-title">${title}</span><button type="button" class="btn small" id="window-close">Done</button></div>${body}</div>`;
    this.refs = refs;
    $('window-close').addEventListener('click', () => this.closeScreen());
    el.querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      if (game.enchantItem(w.data, Number(b.dataset.offer))) {
        this.renderWindow();
        this.refreshHotbar();
      }
    }));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.creativeTab = b.dataset.tab;
      this.renderWindow();
    }));
    const search = $('creative-search');
    if (search) {
      search.addEventListener('input', () => {
        this.search = search.value;
        const pos = search.selectionStart;
        this.renderWindow();
        const again = $('creative-search');
        again.focus();
        again.setSelectionRange(pos, pos);
      });
      search.addEventListener('keydown', (e) => e.stopPropagation());
    }
    this.renderCursor();
  }

  renderCursor(x, y) {
    const c = this.game.inventory.cursor;
    const el = $('cursor-stack');
    if (!c) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<img alt="" src="${this.icon(c.item)}">${c.count > 1 ? `<span class="n">${c.count}</span>` : ''}`;
    if (x !== undefined) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }

  bindWindowPointer() {
    const win = $('window');
    let press = null;
    win.addEventListener('pointermove', (e) => {
      $('cursor-stack').style.left = `${e.clientX}px`;
      $('cursor-stack').style.top = `${e.clientY}px`;
      const target = e.target.closest?.('.slot');
      const tip = $('tooltip');
      const ref = target ? this.refs?.[Number(target.dataset.ref)] : null;
      const s = ref ? (ref.inv.slots[ref.index]) : null;
      this.hoverRef = ref;
      if (s && !this.game.inventory.cursor && e.pointerType === 'mouse') {
        const item = ITEMS[s.item];
        const dur = item.durability && s.damage ? `Durability ${item.durability - s.damage} / ${item.durability}` : '';
        tip.innerHTML = `${escapeHtml(item.name)}${describe(s).map((l) => `<br><span class="ench">${escapeHtml(l)}</span>`).join('')}${dur ? `<br><span class="dim">${dur}</span>` : ''}`;
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY - 28}px`;
        tip.hidden = false;
      } else {
        tip.hidden = true;
      }
    });
    win.addEventListener('contextmenu', (e) => e.preventDefault());
    win.addEventListener('pointerdown', (e) => {
      const target = e.target.closest?.('.slot');
      if (!target) {
        if (e.target === win) this.closeScreen();
        return;
      }
      e.preventDefault();
      const ref = this.refs[Number(target.dataset.ref)];
      if (e.pointerType === 'touch') {
        // Tap = left click, long press = right click.
        press = { ref, timer: setTimeout(() => { press.fired = true; this.click(ref, 2, false); }, 350), fired: false };
        return;
      }
      this.click(ref, e.button === 2 ? 2 : 0, e.shiftKey);
      $('cursor-stack').style.left = `${e.clientX}px`;
      $('cursor-stack').style.top = `${e.clientY}px`;
    });
    win.addEventListener('pointerup', (e) => {
      if (!press || e.pointerType !== 'touch') return;
      clearTimeout(press.timer);
      if (!press.fired) this.click(press.ref, 0, false);
      $('cursor-stack').style.left = `${e.clientX}px`;
      $('cursor-stack').style.top = `${e.clientY - 40}px`;
      press = null;
    });
  }

  // Number key while hovering a slot: swap it with that hotbar slot.
  hotkeySwap(n) {
    const ref = this.hoverRef;
    if (!ref || ref.kind === 'creative' || ref.kind === 'craft-result' || ref.kind === 'result') return false;
    const main = this.game.inventory.main.slots;
    const a = ref.inv.slots[ref.index];
    ref.inv.slots[ref.index] = main[n];
    main[n] = a;
    this.refreshHotbar();
    return true;
  }

  click(ref, button, shift) {
    const game = this.game;
    const inv = game.inventory;
    const w = this.window;
    if (ref.kind === 'creative') {
      const item = ref.creative;
      if (inv.cursor) inv.cursor = null;
      else if (shift) {
        const slots = inv.main.slots;
        const free = slots.findIndex((s, i) => i < 9 && !s);
        slots[free >= 0 ? free : game.selected] = { item, count: maxStack(item), damage: 0 };
      } else {
        inv.cursor = { item, count: button === 2 ? 1 : maxStack(item), damage: 0 };
      }
    } else if (ref.kind === 'craft-result') {
      const r = craftingResult(ref.grid, ref.size);
      if (r) {
        if (shift) {
          for (let n = 0; n < 64; n++) {
            const now = craftingResult(ref.grid, ref.size);
            if (!now || now.item !== r.item) break;
            const made = takeCraft(ref.grid, ref.size);
            const left = inv.give(made);
            if (left) {
              game.throwStack({ ...made, count: left });
              break;
            }
          }
        } else if (!inv.cursor || (inv.cursor.item === r.item && inv.cursor.count + r.count <= maxStack(r.item) && maxStack(r.item) > 1)) {
          const made = takeCraft(ref.grid, ref.size);
          if (inv.cursor) inv.cursor.count += made.count;
          else inv.cursor = made;
        }
        game.advancements.check(inv);
        if (inv.cursor) game.advancements.check({ main: { slots: [inv.cursor] }, armor: inv.armor });
      }
    } else if (ref.kind === 'result') {
      const s = ref.inv.slots[ref.index];
      if (s) {
        if (shift) {
          const left = inv.give(s);
          ref.inv.slots[ref.index] = left ? { ...s, count: left } : null;
        } else if (!inv.cursor) {
          inv.cursor = s;
          ref.inv.slots[ref.index] = null;
        } else if (inv.cursor.item === s.item && inv.cursor.count + s.count <= maxStack(s.item)) {
          inv.cursor.count += s.count;
          ref.inv.slots[ref.index] = null;
        }
        game.advancements.check({ main: { slots: [inv.cursor ?? s] }, armor: inv.armor });
        if (w?.kind === 'furnace' && ref.inv.slots[ref.index] !== s) game.collectFurnaceXp(w.data);
      }
    } else if (shift) {
      quickMove(ref, this.shiftTargets(ref));
    } else {
      clickSlot(inv, ref, button);
    }
    game.advancements.check(inv);
    this.renderWindow();
    this.refreshHotbar();
    void w;
  }

  // Where shift-click sends a stack, by section.
  shiftTargets(ref) {
    const refs = this.refs.filter((r) => r !== ref && r.kind !== 'craft-result' && r.kind !== 'creative');
    const by = (...names) => refs.filter((r) => names.includes(r.section));
    const s = ref.inv.slots[ref.index];
    const item = s ? ITEMS[s.item] : null;
    switch (ref.section) {
      case 'main': {
        if (item?.armor && this.window.kind === 'inventory') return [...by('armor').filter((r) => r.armorSlot === item.armor.slot), ...by('hotbar')];
        if (this.window.kind === 'furnace') return SMELTING[s.item] ? by('input') : item?.fuel ? by('fuel') : by('hotbar');
        if (this.window.kind === 'chest') return by('chest');
        if (this.window.kind === 'enchant') return s.item === 'lapis_lazuli' ? by('lapis') : by('enchant');
        return by('hotbar');
      }
      case 'hotbar': {
        if (item?.armor && this.window.kind === 'inventory') return [...by('armor').filter((r) => r.armorSlot === item.armor.slot), ...by('main')];
        if (this.window.kind === 'furnace') return SMELTING[s.item] ? by('input') : item?.fuel ? by('fuel') : by('main');
        if (this.window.kind === 'chest') return by('chest');
        if (this.window.kind === 'enchant') return s.item === 'lapis_lazuli' ? by('lapis') : by('enchant');
        return by('main');
      }
      default:
        return [...by('main'), ...by('hotbar')];
    }
  }

  // ---------------------------------------------------------------- advancements screen

  renderAdvancements() {
    const game = this.game;
    const next = game.advancements.next();
    const done = game.advancements.done;
    $('adv-summary').textContent = `${done.size} of ${ADVANCEMENTS.length} done.${next ? ` Next up: ${next.title}.` : ' You have done everything. Well played.'}`;
    $('adv-list').innerHTML = ADVANCEMENTS.map((a) => {
      const item = a.has?.[0] ?? { kill: 'iron_sword', sleep: 'bed', nether: 'obsidian', fortress: 'nether_bricks', stronghold: 'eye_of_ender', end: 'end_stone', dragon: 'dragon_egg' }[a.event] ?? 'iron_chestplate';
      const cls = done.has(a.id) ? 'done' : a === next ? 'next' : 'locked';
      return `<div class="adv ${cls}"><img alt="" src="${this.icon(item)}"><b>${escapeHtml(a.title)}</b><span>${escapeHtml(a.about)}</span></div>`;
    }).join('');
  }
}
