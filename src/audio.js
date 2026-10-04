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
