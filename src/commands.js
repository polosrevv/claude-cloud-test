// Chat commands, Minecraft style: /gamemode, /give, /tp, /time, /summon ...
import { ITEMS, findItem, itemName } from './items.js';
import { B, BLOCKS } from './blocks.js';
import { MOBS, createMob, createSlime } from './mobs.js';
import { HEIGHT } from './constants.js';
import { ENCHANTMENTS, enchantName, fits } from './enchantments.js';

const GAMEMODES = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
const DIFFICULTIES = { peaceful: 'peaceful', p: 'peaceful', 0: 'peaceful', easy: 'easy', e: 'easy', 1: 'easy', normal: 'normal', n: 'normal', 2: 'normal', hard: 'hard', h: 'hard', 3: 'hard' };
const TIMES = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
const GAMERULES = ['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'naturalRegeneration'];

export const COMMANDS = {
  help: { usage: '/help', about: 'List the commands' },
  gamemode: { usage: '/gamemode <survival|creative|spectator>', about: 'Change your game mode' },
  difficulty: { usage: '/difficulty <peaceful|easy|normal|hard>', about: 'How dangerous mobs are' },
  time: { usage: '/time set <day|noon|night|midnight|ticks> or /time add <ticks>', about: 'Change the time of day' },
  weather: { usage: '/weather <clear|rain|thunder> [seconds]', about: 'Change the weather' },
  tp: { usage: '/tp <x> <y> <z>', about: 'Teleport (use ~ for relative coordinates)' },
  give: { usage: '/give <item> [count]', about: 'Give yourself items' },
  summon: { usage: '/summon <mob> [x y z]', about: 'Spawn a mob' },
  xp: { usage: '/xp <amount>[L] or /xp add|set <amount> [levels|points]', about: 'Give yourself experience' },
  enchant: { usage: '/enchant <enchantment> [level]', about: 'Enchant the item in your hand' },
  kill: { usage: '/kill [@e|@e[type=<mob>]]', about: 'Kill yourself or mobs' },
  setblock: { usage: '/setblock <x> <y> <z> <block>', about: 'Place one block' },
  fill: { usage: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>', about: 'Fill a box with a block' },
  clear: { usage: '/clear', about: 'Empty your inventory' },
  spawnpoint: { usage: '/spawnpoint', about: 'Respawn where you stand' },
  seed: { usage: '/seed', about: 'Show the world seed' },
  gamerule: { usage: '/gamerule <rule> [true|false]', about: 'keepInventory, doDaylightCycle, doWeatherCycle, doMobSpawning, mobGriefing, naturalRegeneration' },
  locate: { usage: '/locate <stronghold|fortress>', about: 'Find the nearest structure' },
  heal: { usage: '/heal', about: 'Restore health and hunger' },
  say: { usage: '/say <message>', about: 'Say something in chat' },
};

function coord(text, base) {
  if (text === undefined) return NaN;
  if (text.startsWith('~')) return base + (text.length > 1 ? Number(text.slice(1)) : 0);
  return Number(text);
}

function blockByName(name) {
  const key = String(name).toLowerCase().replace(/^minecraft:/, '');
  const item = findItem(key);
  const blockKey = item && ITEMS[item].block ? ITEMS[item].block : key;
  const id = B[blockKey.toUpperCase()];
  if (id !== undefined) return id;
  if (item === 'furnace') return B.FURNACE_S;
  if (item === 'chest') return B.CHEST_S;
  return null;
}

export function runCommand(game, text) {
  const parts = text.trim().replace(/^\//, '').split(/\s+/);
  const name = parts.shift()?.toLowerCase();
  const args = parts;
  const p = game.player;
  const out = [];
  const say = (msg, kind = 'info') => out.push({ text: msg, kind });
  const err = (msg) => say(msg, 'error');
  const needsCheats = name !== 'help' && name !== 'seed' && name !== 'say';
  if (needsCheats && !game.cheats) {
    err('Commands are off in this world. Create a world with cheats on to use them.');
    return out;
  }
  switch (name) {
    case 'help':
    case '?':
      for (const [, c] of Object.entries(COMMANDS)) say(`${c.usage} · ${c.about}`);
      break;
    case 'gamemode': {
      const mode = GAMEMODES[args[0]?.toLowerCase()];
      if (!mode) { err(`Usage: ${COMMANDS.gamemode.usage}`); break; }
      game.setGameMode(mode);
      say(`Game mode set to ${mode[0].toUpperCase()}${mode.slice(1)}`);
      break;
    }
    case 'difficulty': {
      const d = DIFFICULTIES[args[0]?.toLowerCase()];
      if (!d) { say(`The difficulty is ${game.difficulty}`); break; }
      game.difficulty = d;
      say(`Difficulty set to ${d[0].toUpperCase()}${d.slice(1)}`);
      break;
    }
    case 'time': {
      const sub = args[0];
      if (sub === 'set') {
        const v = TIMES[args[1]] ?? Number(args[1]);
        if (!Number.isFinite(v)) { err(`Usage: ${COMMANDS.time.usage}`); break; }
        game.setTime(v);
        say(`Set the time to ${v}`);
      } else if (sub === 'add') {
        const v = Number(args[1]);
        if (!Number.isFinite(v)) { err(`Usage: ${COMMANDS.time.usage}`); break; }
        game.setTime(game.dayTicks + v);
        say(`Added ${v} to the time`);
      } else if (sub === 'query') {
        say(`The time is ${Math.floor(game.dayTicks % 24000)}`);
      } else err(`Usage: ${COMMANDS.time.usage}`);
      break;
    }
    case 'weather': {
      const kind = args[0]?.toLowerCase();
      if (!['clear', 'rain', 'thunder'].includes(kind)) { err(`Usage: ${COMMANDS.weather.usage}`); break; }
      const secs = Number(args[1]);
      game.weather.set(kind, Number.isFinite(secs) && secs > 0 ? Math.round(secs * 20) : undefined);
      say({ clear: 'Set the weather to clear', rain: 'Set the weather to rain', thunder: 'Set the weather to rain & thunder' }[kind]);
      break;
    }
    case 'tp':
    case 'teleport': {
      const x = coord(args[0], p.pos[0]);
      const y = coord(args[1], p.pos[1]);
      const z = coord(args[2], p.pos[2]);
      if (![x, y, z].every(Number.isFinite)) { err(`Usage: ${COMMANDS.tp.usage}`); break; }
      game.teleportPlayer(x, y, z);
      say(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      break;
    }
    case 'give': {
      const rest = args[0]?.startsWith('@') ? args.slice(1) : args;
      const item = findItem(rest[0] ?? '');
      if (!item) { err(rest[0] ? `Unknown item "${rest[0]}"` : `Usage: ${COMMANDS.give.usage}`); break; }
      const count = Math.max(1, Math.min(64 * 36, Number(rest[1]) || 1));
      let left = count;
      while (left > 0) {
        const n = Math.min(left, ITEMS[item].maxStack);
        const over = game.inventory.give({ item, count: n });
        if (over) game.dropStacks(p.eye, [{ item, count: over }]);
        left -= n;
      }
      game.hud.refreshHotbar();
      say(`Gave ${count} [${itemName(item)}]`);
      break;
    }
    case 'xp':
    case 'experience': {
      const words = args.filter((a) => !a.startsWith('@'));
      let mode = 'add';
      if (['add', 'set', 'query'].includes(words[0])) mode = words.shift();
      if (mode === 'query') { say(`You are level ${p.xpLevel}`); break; }
      const n = parseInt(words[0] ?? '', 10);
      if (!Number.isFinite(n)) { err(`Usage: ${COMMANDS.xp.usage}`); break; }
      const levels = /l$/i.test(words[0]) || /^level/i.test(words[1] ?? '');
      if (levels) {
        p.xpLevel = Math.max(0, mode === 'set' ? n : p.xpLevel + n);
        if (mode === 'set') p.xpProgress = 0;
        say(mode === 'set' ? `Set your level to ${p.xpLevel}` : `Gave ${n} experience levels`);
      } else {
        if (mode === 'set') { p.xpLevel = 0; p.xpProgress = 0; }
        game.addXp(n);
        say(mode === 'set' ? `Set your experience to ${n} points` : `Gave ${n} experience points`);
      }
      break;
    }
    case 'enchant': {
      const words = args.filter((a) => !a.startsWith('@'));
      const key = words[0]?.toLowerCase().replace(/^minecraft:/, '');
      const held = game.heldStack();
      if (!ENCHANTMENTS[key]) { err(`Unknown enchantment. Try: ${Object.keys(ENCHANTMENTS).join(', ')}`); break; }
      if (!held) { err('Hold the item you want to enchant'); break; }
      if (!fits(key, held.item)) { err(`${ITEMS[held.item].name} can't be enchanted with ${ENCHANTMENTS[key].name}`); break; }
      const lvl = Math.max(1, Math.min(ENCHANTMENTS[key].max, Number(words[1]) || 1));
      held.ench = { ...(held.ench || {}), [key]: lvl };
      game.hud.refreshHotbar();
      say(`Applied ${enchantName(key, lvl)} to ${ITEMS[held.item].name}`);
      break;
    }
    case 'summon': {
      const type = args[0]?.toLowerCase().replace(/^minecraft:/, '').replace('ender_dragon', 'dragon').replace('zombified_piglin', 'zombie_pigman');
      if (!MOBS[type]) { err(`Unknown mob. Try: ${Object.keys(MOBS).join(', ')}`); break; }
      const x = args.length >= 4 ? coord(args[1], p.pos[0]) : p.pos[0] + p.look[0] * 3;
      const y = args.length >= 4 ? coord(args[2], p.pos[1]) : p.pos[1];
      const z = args.length >= 4 ? coord(args[3], p.pos[2]) : p.pos[2] + p.look[2] * 3;
      const mob = type === 'slime' ? createSlime([1, 2, 4][Math.floor(Math.random() * 3)], x, y, z) : createMob(type, x, y, z);
      if (type === 'dragon') { mob.phase = 'circle'; mob.phaseTime = 0; mob.angle = 0; }
      mob.persistent = !MOBS[type].hostile;
      game.entities.add(mob);
      say(`Summoned new ${MOBS[type].name}`);
      break;
    }
    case 'kill': {
      const target = args[0] ?? '@s';
      if (target === '@s' || target === '@p') {
        game.killPlayer('command');
        break;
      }
      const m = target.match(/^@e(?:\[type=(?:minecraft:)?(\w+)\])?$/);
      if (!m) { err(`Usage: ${COMMANDS.kill.usage}`); break; }
      let n = 0;
      for (const e of game.entities.list) {
        if (e.kind === 'mob' && (!m[1] || e.type === m[1])) { e.removed = true; n++; }
        if (!m[1] && (e.kind === 'item' || e.kind === 'projectile')) e.removed = true;
      }
      say(`Killed ${n} ${n === 1 ? 'entity' : 'entities'}`);
      break;
    }
    case 'setblock': {
      const x = Math.floor(coord(args[0], p.pos[0]));
      const y = Math.floor(coord(args[1], p.pos[1]));
      const z = Math.floor(coord(args[2], p.pos[2]));
      const id = blockByName(args[3] ?? '');
      if (![x, y, z].every(Number.isFinite) || id === null) { err(`Usage: ${COMMANDS.setblock.usage}`); break; }
      if (y < 0 || y >= HEIGHT || !game.world.isLoaded(x, z)) { err('That position is out of the world'); break; }
      game.world.setBlock(x, y, z, id);
      say('Changed the block');
      break;
    }
    case 'fill': {
      const c = args.slice(0, 6).map((v, i) => Math.floor(coord(v, p.pos[i % 3])));
      const id = blockByName(args[6] ?? '');
      if (!c.every(Number.isFinite) || id === null) { err(`Usage: ${COMMANDS.fill.usage}`); break; }
      const [x0, x1] = [Math.min(c[0], c[3]), Math.max(c[0], c[3])];
      const [y0, y1] = [Math.max(0, Math.min(c[1], c[4])), Math.min(HEIGHT - 1, Math.max(c[1], c[4]))];
      const [z0, z1] = [Math.min(c[2], c[5]), Math.max(c[2], c[5])];
      const volume = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (volume > 32768) { err(`Too many blocks in the area (${volume} > 32768)`); break; }
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (game.world.setBlock(x, y, z, id)) n++;
      say(`Successfully filled ${n} block${n === 1 ? '' : 's'}`);
      break;
    }
    case 'clear':
      game.inventory.main.clear();
      game.inventory.armor.clear();
      game.hud.refreshHotbar();
      say('Cleared your inventory');
      break;
    case 'spawnpoint':
      game.setSpawn(p.pos, game.world.dimension);
      say(`Set spawn point to ${p.pos.map((v) => Math.floor(v)).join(', ')}`);
      break;
    case 'seed':
      say(`Seed: [${game.seedText}]`);
      break;
    case 'gamerule': {
      const rule = GAMERULES.find((r) => r.toLowerCase() === args[0]?.toLowerCase());
      if (!rule) { err(`Unknown game rule. Rules: ${GAMERULES.join(', ')}`); break; }
      if (args[1] === undefined) { say(`Gamerule ${rule} is currently set to: ${game.gamerules[rule]}`); break; }
      if (args[1] !== 'true' && args[1] !== 'false') { err('Use true or false'); break; }
      game.gamerules[rule] = args[1] === 'true';
      say(`Gamerule ${rule} is now set to: ${args[1]}`);
      break;
    }
    case 'locate': {
      const kind = (args[0] === 'structure' ? args[1] : args[0])?.toLowerCase().replace(/^minecraft:/, '');
      const found = game.world.terrain.locate?.(kind, p.pos[0], p.pos[2]);
      if (!found) { err(kind === 'fortress' ? 'Fortresses are in the Nether' : kind === 'stronghold' ? 'Strongholds are in the Overworld' : `Usage: ${COMMANDS.locate.usage}`); break; }
      say(`The nearest ${kind} is at ${found.x}, ~, ${found.z} (${Math.round(found.distance)} blocks away)`);
      break;
    }
    case 'heal':
      p.health = 20;
      p.food = 20;
      p.saturation = 5;
      p.fireTicks = 0;
      say('Healed');
      break;
    case 'say':
      say(`[You] ${args.join(' ')}`, 'chat');
      break;
    default:
      err(`Unknown command "${name}". Type /help for a list.`);
  }
  return out;
}

// Tab completion for the chat box.
export function complete(text) {
  const t = text.replace(/^\//, '');
  const parts = t.split(/\s+/);
  if (parts.length === 1) return Object.keys(COMMANDS).filter((c) => c.startsWith(parts[0].toLowerCase())).map((c) => `/${c}`);
  const cmd = parts[0].toLowerCase();
  const last = parts[parts.length - 1].toLowerCase();
  const head = `/${parts.slice(0, -1).join(' ')} `;
  let options = [];
  if (cmd === 'give' && parts.length === 2) options = Object.keys(ITEMS);
  else if ((cmd === 'setblock' && parts.length === 5) || (cmd === 'fill' && parts.length === 8)) options = BLOCKS.filter((b) => !b.hidden).map((b) => b.key);
  else if (cmd === 'summon' && parts.length === 2) options = Object.keys(MOBS);
  else if (cmd === 'gamemode') options = ['survival', 'creative', 'spectator'];
  else if (cmd === 'difficulty') options = ['peaceful', 'easy', 'normal', 'hard'];
  else if (cmd === 'time') options = parts.length === 2 ? ['set', 'add', 'query'] : Object.keys(TIMES);
  else if (cmd === 'gamerule' && parts.length === 2) options = GAMERULES;
  else if (cmd === 'gamerule' && parts.length === 3) options = ['true', 'false'];
  else if (cmd === 'locate') options = ['stronghold', 'fortress'];
  else if (cmd === 'weather' && parts.length === 2) options = ['clear', 'rain', 'thunder'];
  else if (cmd === 'enchant' && parts.length === 2) options = Object.keys(ENCHANTMENTS);
  else if (cmd === 'xp' && parts.length === 2) options = ['add', 'set', 'query'];
  else if (cmd === 'kill') options = ['@s', '@e', ...Object.keys(MOBS).map((m) => `@e[type=${m}]`)];
  return options.filter((o) => o.toLowerCase().startsWith(last)).map((o) => head + o);
}
