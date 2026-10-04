// Tiny synthesised sound effects: filtered noise bursts shaped per material.
// Browsers only allow audio after a user gesture, so start() is called from one.

let ctx = null;
let noise = null;
let master = null;
let enabled = true;

const MATERIAL = {
  grass: { type: 'lowpass', freq: 1400, q: 0.7, gain: 0.5, decay: 0.12 },
  stone: { type: 'bandpass', freq: 2200, q: 1.2, gain: 0.7, decay: 0.09 },
  wood: { type: 'bandpass', freq: 650, q: 2.5, gain: 0.9, decay: 0.1 },
  sand: { type: 'highpass', freq: 2600, q: 0.6, gain: 0.35, decay: 0.14 },
  gravel: { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.6, decay: 0.13 },
  glass: { type: 'highpass', freq: 3800, q: 1.5, gain: 0.5, decay: 0.2 },
  cloth: { type: 'lowpass', freq: 700, q: 0.5, gain: 0.45, decay: 0.1 },
  snow: { type: 'lowpass', freq: 2400, q: 0.4, gain: 0.35, decay: 0.12 },
  water: { type: 'lowpass', freq: 900, q: 0.8, gain: 0.6, decay: 0.35 },
};

export function startAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setSoundEnabled(on) {
  enabled = on;
}

// kind: 'break' | 'place' | 'step' | 'splash'
export function playBlockSound(material, kind = 'break') {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const m = MATERIAL[material] || MATERIAL.stone;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = kind === 'step' ? 0.7 : 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = m.type;
  filter.frequency.value = m.freq * (kind === 'place' ? 0.75 : 1) * (0.92 + Math.random() * 0.16);
  filter.Q.value = m.q;
  const gain = ctx.createGain();
  const level = m.gain * (kind === 'step' ? 0.25 : kind === 'place' ? 0.8 : 1);
  const decay = m.decay * (kind === 'step' ? 0.6 : kind === 'splash' ? 2 : 1);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  src.connect(filter).connect(gain).connect(master);
  src.start(now, Math.random() * 0.5);
  src.stop(now + decay + 0.02);
  if (material === 'glass' && kind === 'break') {
    for (let i = 0; i < 3; i++) chime(now + i * 0.03, 2400 + Math.random() * 1800);
  }
}

function chime(at, freq) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.12, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  osc.connect(g).connect(master);
  osc.start(at);
  osc.stop(at + 0.3);
}

// ---- Voices and effects ----
function tone(type, f0, f1, dur, gain = 0.3, at = 0, filter = null) {
  const now = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  let node = osc;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter[0];
    f.frequency.value = filter[1];
    node = osc.connect(f);
  }
  node.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.05);
  return osc;
}

function hiss(type, freq, dur, gain = 0.3, at = 0, q = 0.8) {
  const now = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(f).connect(g).connect(master);
  src.start(now);
  src.stop(now + dur + 0.05);
}

const VOICES = {
  pig_say: (v) => { tone('square', 220, 150, 0.12, 0.12 * v, 0, ['lowpass', 900]); tone('square', 200, 140, 0.12, 0.12 * v, 0.16, ['lowpass', 900]); },
  pig_hurt: (v) => tone('square', 320, 200, 0.18, 0.15 * v, 0, ['lowpass', 1200]),
  pig_death: (v) => tone('square', 260, 90, 0.5, 0.15 * v, 0, ['lowpass', 900]),
  cow_say: (v) => tone('sawtooth', 130, 95, 0.7, 0.18 * v, 0, ['lowpass', 500]),
  cow_hurt: (v) => tone('sawtooth', 160, 110, 0.3, 0.2 * v, 0, ['lowpass', 600]),
  cow_death: (v) => tone('sawtooth', 140, 60, 0.8, 0.2 * v, 0, ['lowpass', 500]),
  sheep_say: (v) => { for (let i = 0; i < 4; i++) tone('sawtooth', 420, 380, 0.09, 0.08 * v, i * 0.09, ['lowpass', 1600]); },
  sheep_hurt: (v) => tone('sawtooth', 500, 380, 0.2, 0.12 * v, 0, ['lowpass', 1600]),
  sheep_death: (v) => tone('sawtooth', 450, 200, 0.5, 0.12 * v, 0, ['lowpass', 1400]),
  chicken_say: (v) => { tone('triangle', 900, 1300, 0.06, 0.1 * v); tone('triangle', 1000, 1400, 0.06, 0.1 * v, 0.1); },
  chicken_hurt: (v) => tone('triangle', 1400, 900, 0.15, 0.12 * v),
  chicken_death: (v) => tone('triangle', 1200, 500, 0.3, 0.12 * v),
  zombie_say: (v) => { tone('sawtooth', 85, 70, 0.9, 0.12 * v, 0, ['lowpass', 380]); hiss('lowpass', 400, 0.8, 0.08 * v); },
  zombie_hurt: (v) => tone('sawtooth', 120, 80, 0.3, 0.16 * v, 0, ['lowpass', 500]),
  zombie_death: (v) => tone('sawtooth', 100, 45, 0.9, 0.16 * v, 0, ['lowpass', 400]),
  skeleton_say: (v) => { for (let i = 0; i < 5; i++) hiss('highpass', 2500, 0.03, 0.12 * v, i * 0.05, 2); },
  skeleton_hurt: (v) => { for (let i = 0; i < 3; i++) hiss('bandpass', 1800, 0.04, 0.16 * v, i * 0.04, 3); },
  skeleton_death: (v) => { for (let i = 0; i < 8; i++) hiss('highpass', 2000, 0.04, 0.12 * v, i * 0.06, 2); },
  creeper_say: () => {},
  creeper_fuse: (v) => hiss('highpass', 3200, 1.5, 0.18 * v, 0, 0.5),
  creeper_hurt: (v) => hiss('bandpass', 1400, 0.2, 0.15 * v),
  creeper_death: (v) => hiss('bandpass', 900, 0.5, 0.15 * v),
  spider_say: (v) => hiss('bandpass', 1100, 0.25, 0.1 * v, 0, 2),
  spider_hurt: (v) => hiss('bandpass', 1500, 0.2, 0.14 * v, 0, 2),
  spider_death: (v) => hiss('bandpass', 700, 0.6, 0.14 * v, 0, 2),
  enderman_say: (v) => tone('sine', 220, 140, 0.6, 0.08 * v),
  enderman_stare: (v) => { tone('sawtooth', 60, 220, 1.2, 0.12 * v, 0, ['lowpass', 900]); hiss('bandpass', 300, 1.2, 0.08 * v); },
  enderman_hurt: (v) => tone('sine', 400, 120, 0.4, 0.14 * v),
  enderman_death: (v) => tone('sine', 300, 60, 1.2, 0.14 * v),
  blaze_say: (v) => { hiss('bandpass', 600, 0.6, 0.08 * v); tone('sine', 110, 90, 0.6, 0.06 * v); },
  blaze_shoot: (v) => hiss('lowpass', 1200, 0.25, 0.18 * v),
  blaze_hurt: (v) => hiss('bandpass', 900, 0.25, 0.16 * v),
  blaze_death: (v) => hiss('lowpass', 700, 1, 0.16 * v),
  dragon_flap: (v) => hiss('lowpass', 250, 0.5, 0.25 * v),
  dragon_hurt: (v) => { tone('sawtooth', 70, 50, 0.8, 0.22 * v, 0, ['lowpass', 500]); hiss('lowpass', 500, 0.8, 0.1 * v); },
  dragon_death: (v) => { tone('sawtooth', 80, 30, 4, 0.25 * v, 0, ['lowpass', 400]); hiss('lowpass', 400, 4, 0.12 * v); },
  dragon_say: (v) => tone('sawtooth', 65, 50, 1.4, 0.2 * v, 0, ['lowpass', 450]),
  hurt: (v) => tone('square', 260, 130, 0.12, 0.14 * v, 0, ['lowpass', 1400]),
  explode: (v) => { hiss('lowpass', 900, 1.4, 0.6 * v, 0, 0.5); tone('sine', 70, 30, 0.9, 0.5 * v); },
  explode_small: (v) => hiss('lowpass', 700, 0.6, 0.3 * v, 0, 0.5),
  pop: (v) => tone('sine', 600, 950, 0.07, 0.12 * v),
  fizz: (v) => hiss('highpass', 2500, 0.6, 0.12 * v, 0, 0.5),
  eat: (v) => { for (let i = 0; i < 3; i++) hiss('bandpass', 900 + Math.random() * 400, 0.06, 0.12 * v, i * 0.08, 1.5); },
  burp: (v) => tone('sawtooth', 160, 90, 0.3, 0.12 * v, 0, ['lowpass', 700]),
  bow: (v) => { tone('triangle', 320, 140, 0.2, 0.15 * v); hiss('bandpass', 1500, 0.15, 0.08 * v); },
  arrow_hit: (v) => hiss('bandpass', 2400, 0.06, 0.15 * v, 0, 3),
  door: (v) => tone('sawtooth', 210, 150, 0.25, 0.08 * v, 0, ['lowpass', 500]),
  click: (v) => hiss('highpass', 3000, 0.03, 0.12 * v, 0, 2),
  teleport: (v) => tone('sine', 220, 880, 0.4, 0.12 * v),
  portal: (v) => { hiss('bandpass', 500, 2, 0.15 * v, 0, 1); tone('sine', 120, 480, 2, 0.06 * v); },
  glass: (v) => { for (let i = 0; i < 3; i++) chime(ctx.currentTime + i * 0.03, 2400 + Math.random() * 1800); void v; },
  splash: (v) => hiss('lowpass', 900, 0.5, 0.25 * v),
  levelup: (v) => { tone('sine', 523, 523, 0.25, 0.12 * v); tone('sine', 659, 659, 0.25, 0.12 * v, 0.12); tone('sine', 784, 784, 0.45, 0.12 * v, 0.24); },
  break_tool: (v) => { hiss('highpass', 2000, 0.3, 0.2 * v); tone('square', 900, 300, 0.2, 0.08 * v); },
};

// Named effect at a volume from 0 to 1 (callers attenuate by distance).
export function playSound(name, volume = 1) {
  if (!enabled || !ctx || ctx.state !== 'running' || volume <= 0.02) return;
  const voice = VOICES[name];
  if (voice) voice(Math.min(1, volume));
}
