// World dimensions shared by generation, meshing and gameplay.
export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 48;
export const blockIndex = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

// Game ticks per second; timers in the simulation count these.
export const TPS = 20;
