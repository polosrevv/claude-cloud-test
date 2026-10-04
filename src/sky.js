// Day/night cycle. timeOfDay runs 0..1: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.

export const DAY_SECONDS = 1200; // a full day lasts 20 minutes

const DAY_ZENITH = [0.36, 0.6, 1.0];
const DAY_HORIZON = [0.72, 0.84, 1.0];
const NIGHT_ZENITH = [0.01, 0.015, 0.05];
const NIGHT_HORIZON = [0.035, 0.05, 0.11];
const SUNSET_HORIZON = [0.96, 0.52, 0.3];
const MOONLIGHT = [0.55, 0.65, 1.0];
const WARM = [1.0, 0.82, 0.66];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function skyAt(timeOfDay) {
  const a = timeOfDay * Math.PI * 2;
  const len = Math.hypot(Math.cos(a), Math.sin(a), 0.18);
  const sunDir = [Math.cos(a) / len, Math.sin(a) / len, 0.18 / len];
  const h = sunDir[1];
  const day = smoothstep(-0.18, 0.22, h);
  const sunset = Math.max(0, 1 - Math.abs(h) / 0.3);
  const night = 1 - smoothstep(-0.3, 0.02, h);
  const zenith = mix(NIGHT_ZENITH, DAY_ZENITH, day);
  const horizon = mix(mix(NIGHT_HORIZON, DAY_HORIZON, day), SUNSET_HORIZON, sunset * 0.5 * Math.max(day, 0.3));
  return {
    sunDir,
    zenith,
    horizon,
    sunsetColor: SUNSET_HORIZON,
    sunset,
    night,
    daylight: 0.16 + 0.84 * day,
    skyTint: mix(mix(MOONLIGHT, [1, 1, 1], day), WARM, sunset * 0.45),
    cloudColor: mix(mix([0.1, 0.11, 0.16], [1, 1, 1], day), [1.0, 0.78, 0.7], sunset * 0.35),
  };
}

export function clockLabel(timeOfDay) {
  // Sunrise at 06:00.
  const minutes = Math.floor(((timeOfDay * 24 + 6) % 24) * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
