// Procedural 16x16 pixel-art textures. Each tile is drawn from its own seeded
// RNG, so the look is identical on every load and no image files are needed.
import { mulberry32, hashString } from './noise.js';

export const TILE = 16;

function put(t, x, y, c, a = 255) {
  const i = (((y & 15) * TILE) + (x & 15)) * 4;
  t[i] = c[0];
  t[i + 1] = c[1];
  t[i + 2] = c[2];
  t[i + 3] = a;
}

const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const jitter = (r, amount) => 1 + (r() * 2 - 1) * amount;

function noiseFill(t, r, base, amount, alpha = 255) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) put(t, x, y, mul(base, jitter(r, amount)), alpha);
  }
}

function specks(t, r, base, count, dark = 0.75, light = 1.18) {
  for (let i = 0; i < count; i++) {
    put(t, (r() * TILE) | 0, (r() * TILE) | 0, mul(base, r() < 0.6 ? dark : light));
  }
}

// Wrapping Voronoi: calls fn(x, y, nearestIndex, edgeDistance) for every pixel.
function voronoi(r, count, fn) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([r() * TILE, r() * TILE]);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let n = 0;
      for (let i = 0; i < count; i++) {
        let dx = Math.abs(x + 0.5 - pts[i][0]);
        let dy = Math.abs(y + 0.5 - pts[i][1]);
        dx = Math.min(dx, TILE - dx);
        dy = Math.min(dy, TILE - dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; n = i; } else if (d < d2) d2 = d;
      }
      fn(x, y, n, d2 - d1);
    }
  }
}

function rings(t, r, light, dark, bark) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 6.3) put(t, x, y, mul(bark, jitter(r, 0.1)));
      else put(t, x, y, mul(Math.floor(d * 0.95 + r() * 0.35) % 2 ? dark : light, jitter(r, 0.05)));
    }
  }
}

function bark(t, r, base, grooves) {
  for (let x = 0; x < TILE; x++) {
    const col = 0.86 + r() * 0.22;
    const groove = grooves.includes(x);
    for (let y = 0; y < TILE; y++) {
      put(t, x, y, mul(base, (groove ? 0.72 : col) * jitter(r, 0.07)));
    }
  }
}

function leaves(t, r, base) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (r() < 0.16) put(t, x, y, base, 0);
      else put(t, x, y, mul(base, 0.72 + r() * 0.5));
    }
  }
}

function fringe(t, r, color, minDepth) {
  for (let x = 0; x < TILE; x++) {
    const depth = minDepth + (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) put(t, x, y, mul(color, (y === depth - 1 ? 0.86 : 1) * jitter(r, 0.08)));
  }
}

function ore(t, r, color, clusters) {
  GEN.stone(t, r);
  const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [-1, 1]];
  for (let i = 0; i < clusters; i++) {
    const cx = 1 + ((r() * 12) | 0);
    const cy = 1 + ((r() * 12) | 0);
    for (const [dx, dy] of shape) {
      if (r() < 0.7) put(t, cx + dx, cy + dy, mul(color, 0.78 + r() * 0.4));
    }
    put(t, cx, cy, mul(color, 1.25));
  }
}

function wool(t, r, color) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let f = jitter(r, 0.04);
      if ((x + y) % 4 === 0) f *= 0.92;
      else if ((x - y + 16) % 4 === 0) f *= 1.05;
      put(t, x, y, mul(color, f));
    }
  }
}

function flower(t, r, stem, petal, centre, cy, radius) {
  for (let y = cy + 1; y < TILE; y++) put(t, 7, y, mul(stem, jitter(r, 0.1)));
  for (const [x, y] of [[6, 12], [5, 11], [8, 13], [9, 12], [10, 11]]) put(t, x, y, mul(stem, jitter(r, 0.12)));
  for (let y = cy - 3; y <= cy + 3; y++) {
    for (let x = 4; x <= 11; x++) {
      if (Math.hypot(x - 7, y - cy) < radius) put(t, x, y, mul(petal, 0.8 + r() * 0.3));
    }
  }
  put(t, 7, cy, centre);
}

const GRASS = [94, 157, 52];
const DIRT = [134, 96, 67];
const STONE = [128, 128, 128];
const PLANK = [162, 130, 78];

const GEN = {
  grass_top(t, r) {
    noiseFill(t, r, GRASS, 0.1);
    specks(t, r, GRASS, 46, 0.8, 1.16);
  },
  dirt(t, r) {
    noiseFill(t, r, DIRT, 0.08);
    specks(t, r, DIRT, 34, 0.72, 1.2);
  },
  grass_side(t, r) {
    GEN.dirt(t, r);
    fringe(t, r, GRASS, 3);
  },
  snowy_grass_side(t, r) {
    GEN.dirt(t, r);
    fringe(t, r, [240, 244, 250], 3);
  },
  stone(t, r) {
    noiseFill(t, r, STONE, 0.05);
    for (let i = 0; i < 11; i++) {
      const x = (r() * TILE) | 0;
      const y = (r() * TILE) | 0;
      const len = 2 + ((r() * 4) | 0);
      const f = r() < 0.6 ? 0.82 : 1.12;
      for (let k = 0; k < len; k++) put(t, x + k, y, mul(STONE, f * jitter(r, 0.04)));
    }
  },
  cobblestone(t, r) {
    const shades = Array.from({ length: 9 }, () => 0.72 + r() * 0.42);
    voronoi(r, 9, (x, y, n, edge) => {
      if (edge < 1.1) put(t, x, y, mul([74, 74, 74], jitter(r, 0.1)));
      else put(t, x, y, mul([136, 136, 136], shades[n] * (edge < 2 ? 0.88 : 1) * jitter(r, 0.07)));
    });
  },
  mossy_cobblestone(t, r) {
    GEN.cobblestone(t, r);
    const moss = [];
    for (let i = 0; i < 4; i++) moss.push([r() * TILE, r() * TILE, 2.5 + r() * 2.5]);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        for (const [mx, my, rad] of moss) {
          if (Math.hypot(x - mx, y - my) < rad && r() < 0.8) put(t, x, y, mul([84, 122, 52], 0.8 + r() * 0.35));
        }
      }
    }
  },
  sand(t, r) {
    noiseFill(t, r, [219, 207, 160], 0.045);
    specks(t, r, [219, 207, 160], 24, 0.88, 1.06);
  },
  gravel(t, r) {
    const palette = [[140, 132, 128], [108, 102, 98], [162, 152, 148], [94, 86, 82], [128, 118, 106]];
    const pick = Array.from({ length: 22 }, () => palette[(r() * palette.length) | 0]);
    voronoi(r, 22, (x, y, n, edge) => put(t, x, y, mul(pick[n], (edge < 0.5 ? 0.7 : 1) * jitter(r, 0.06))));
  },
  bedrock(t, r) {
    const shades = Array.from({ length: 12 }, () => 34 + r() * 90);
    voronoi(r, 12, (x, y, n) => {
      const g = shades[n] * jitter(r, 0.15);
      put(t, x, y, [g, g, g]);
    });
  },
  water(t, r) {
    const base = [44, 92, 204];
    noiseFill(t, r, base, 0.06, 176);
    for (let y = 0; y < TILE; y += 4) {
      const start = (r() * TILE) | 0;
      const len = 3 + ((r() * 6) | 0);
      for (let k = 0; k < len; k++) put(t, start + k, y + ((r() * 2) | 0), [86, 136, 232], 190);
    }
  },
  oak_log(t, r) { bark(t, r, [104, 82, 50], [2, 6, 7, 11, 14]); },
  oak_log_top(t, r) { rings(t, r, [184, 148, 96], [160, 126, 78], [104, 82, 50]); },
  birch_log(t, r) {
    noiseFill(t, r, [218, 216, 208], 0.04);
    for (let i = 0; i < 8; i++) {
      const y = (r() * TILE) | 0;
      const x = (r() * TILE) | 0;
      const len = 2 + ((r() * 4) | 0);
      for (let k = 0; k < len; k++) put(t, x + k, y, mul([52, 50, 46], jitter(r, 0.15)));
    }
  },
  birch_log_top(t, r) { rings(t, r, [204, 184, 132], [186, 164, 112], [218, 216, 208]); },
  spruce_log(t, r) { bark(t, r, [74, 54, 32], [1, 5, 9, 12]); },
  spruce_log_top(t, r) { rings(t, r, [150, 112, 68], [128, 94, 56], [74, 54, 32]); },
  oak_leaves(t, r) { leaves(t, r, [58, 128, 40]); },
  birch_leaves(t, r) { leaves(t, r, [104, 150, 62]); },
  spruce_leaves(t, r) { leaves(t, r, [44, 92, 60]); },
  planks(t, r) {
    const seams = [3, 11, 7, 14];
    for (let y = 0; y < TILE; y++) {
      const board = y >> 2;
      const tone = 0.9 + ((board * 37) % 5) * 0.03;
      for (let x = 0; x < TILE; x++) {
        let f = tone * jitter(r, 0.04);
        if (y % 4 === 3) f = 0.62;
        else if (x === seams[board]) f = 0.68;
        else if (r() < 0.1) f *= 0.86;
        put(t, x, y, mul(PLANK, f));
      }
    }
  },
  glass(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        if (edge) put(t, x, y, mul([226, 240, 246], jitter(r, 0.05)), 255);
        else put(t, x, y, [226, 240, 246], 0);
      }
    }
    for (const [x, y] of [[3, 4], [4, 3], [5, 2], [3, 5], [10, 12], [11, 11], [12, 10], [11, 12]]) put(t, x, y, [255, 255, 255], 220);
  },
  bricks(t, r) {
    for (let y = 0; y < TILE; y++) {
      const row = y >> 2;
      const off = (row % 2) * 4;
      for (let x = 0; x < TILE; x++) {
        if (y % 4 === 3 || (x + off) % 8 === 7) {
          put(t, x, y, mul([180, 170, 158], jitter(r, 0.05)));
        } else {
          const brick = row * 2 + (Math.floor((x + off) / 8) % 2);
          const shade = 0.86 + ((brick * 53) % 7) * 0.035;
          put(t, x, y, mul([152, 72, 58], shade * jitter(r, 0.06)));
        }
      }
    }
  },
  stone_bricks(t, r) {
    noiseFill(t, r, [124, 124, 124], 0.045);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const row = y >> 3;
        const seam = row === 0 ? 15 : 7;
        if (y % 8 === 7 || x === seam) put(t, x, y, mul([78, 78, 78], jitter(r, 0.05)));
        else if (y % 8 === 0 || x === (seam + 1) % 16) put(t, x, y, mul([150, 150, 150], jitter(r, 0.04)));
        else if (y % 8 === 6) put(t, x, y, mul([104, 104, 104], jitter(r, 0.04)));
      }
    }
  },
  snow(t, r) { noiseFill(t, r, [242, 246, 250], 0.025); },
  sandstone(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let c = [216, 200, 150];
        if (y < 3) c = [224, 210, 162];
        else if (y === 3 || y === 11) c = mul(c, 0.88);
        else if (y > 11) c = mul(c, 0.95);
        put(t, x, y, mul(c, jitter(r, 0.035)));
      }
    }
  },
  sandstone_top(t, r) { noiseFill(t, r, [222, 207, 157], 0.035); },
  cactus(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let f = jitter(r, 0.06);
        if (x === 0 || x === 15) f *= 0.68;
        else if ([3, 7, 11].includes(x)) f *= 0.8;
        put(t, x, y, mul([84, 138, 52], f));
      }
    }
    for (let i = 0; i < 9; i++) put(t, 1 + ((r() * 14) | 0), (r() * TILE) | 0, [214, 226, 170]);
  },
  cactus_top(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const f = d > 6.5 ? 0.7 : d < 2 ? 1.18 : Math.floor(d) % 2 ? 0.92 : 1.04;
        put(t, x, y, mul([96, 152, 60], f * jitter(r, 0.05)));
      }
    }
  },
  coal_ore(t, r) { ore(t, r, [38, 38, 38], 5); },
  iron_ore(t, r) { ore(t, r, [214, 174, 146], 4); },
  gold_ore(t, r) { ore(t, r, [246, 212, 64], 4); },
  diamond_ore(t, r) { ore(t, r, [92, 226, 218], 4); },
  glowstone(t, r) {
    const shades = Array.from({ length: 8 }, () => 0.78 + r() * 0.28);
    voronoi(r, 8, (x, y, n, edge) => {
      if (edge < 0.8) put(t, x, y, mul([150, 104, 52], jitter(r, 0.1)));
      else put(t, x, y, mul([255, 222, 140], shades[n] * jitter(r, 0.05)));
    });
  },
  obsidian(t, r) {
    noiseFill(t, r, [24, 18, 34], 0.15);
    for (let i = 0; i < 7; i++) {
      const x = (r() * TILE) | 0;
      const y = (r() * TILE) | 0;
      put(t, x, y, [76, 54, 116]);
      put(t, x + 1, y, [56, 40, 88]);
    }
  },
  tall_grass(t, r) {
    for (let i = 0; i < TILE * TILE; i++) t[i * 4 + 3] = 0;
    for (let b = 0; b < 11; b++) {
      const x = 1 + r() * 14;
      const h = 5 + ((r() * 10) | 0);
      const lean = (r() - 0.5) * 0.5;
      for (let k = 0; k < h; k++) put(t, Math.round(x + lean * k), 15 - k, mul([92, 150, 52], 0.7 + 0.4 * (k / h) + (r() - 0.5) * 0.1));
    }
  },
  poppy(t, r) {
    for (let i = 0; i < TILE * TILE; i++) t[i * 4 + 3] = 0;
    flower(t, r, [62, 118, 40], [204, 34, 30], [56, 22, 20], 6, 2.9);
  },
  dandelion(t, r) {
    for (let i = 0; i < TILE * TILE; i++) t[i * 4 + 3] = 0;
    flower(t, r, [70, 128, 44], [246, 218, 44], [232, 150, 30], 8, 2.3);
  },
  dead_bush(t, r) {
    for (let i = 0; i < TILE * TILE; i++) t[i * 4 + 3] = 0;
    const branch = (x, y, dx, len) => {
      for (let k = 0; k < len; k++) {
        put(t, Math.round(x), y, mul([124, 86, 42], jitter(r, 0.15)));
        x += dx + (r() - 0.5) * 0.6;
        y -= 1;
        if (y < 1) return;
      }
    };
    branch(7.5, 15, 0, 6);
    branch(7.5, 11, -0.7, 7);
    branch(7.5, 12, 0.7, 7);
    branch(7.5, 9, 0.2, 6);
  },
  bookshelf(t, r) {
    GEN.planks(t, r);
    const colors = [[142, 42, 40], [44, 72, 142], [52, 112, 52], [172, 132, 52], [112, 62, 122], [64, 64, 64]];
    for (const [top, bottom] of [[1, 6], [9, 14]]) {
      let x = 1;
      while (x < 15) {
        const w = Math.min(15 - x, 1 + ((r() * 3) | 0));
        const c = colors[(r() * colors.length) | 0];
        const short = r() < 0.4 ? 1 : 0;
        for (let i = 0; i < w; i++) {
          for (let y = top; y <= bottom; y++) put(t, x + i, y, y < top + short ? mul(PLANK, 0.45) : mul(c, (i === 0 ? 1.12 : 1) * jitter(r, 0.05)));
        }
        x += w;
      }
    }
  },
  crafting_table_top(t, r) {
    GEN.planks(t, r);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (x === 0 || y === 0 || x === 15 || y === 15) put(t, x, y, mul([104, 74, 42], jitter(r, 0.06)));
        else if (x === 5 || x === 10 || y === 5 || y === 10) put(t, x, y, mul([120, 88, 50], jitter(r, 0.06)));
      }
    }
  },
  crafting_table_side(t, r) {
    GEN.planks(t, r);
    for (let y = 0; y < 3; y++) for (let x = 0; x < TILE; x++) put(t, x, y, mul([104, 74, 42], jitter(r, 0.06)));
    // A saw on the left, a hammer on the right.
    for (let x = 2; x <= 7; x++) { put(t, x, 6, [170, 170, 176]); put(t, x, 7, [150, 150, 156]); if (x % 2) put(t, x, 8, [130, 130, 136]); }
    put(t, 1, 6, [92, 60, 30]); put(t, 1, 7, [92, 60, 30]);
    for (let y = 6; y <= 13; y++) put(t, 11, y, [92, 60, 30]);
    for (let x = 9; x <= 13; x++) { put(t, x, 4, [150, 150, 156]); put(t, x, 5, [120, 120, 126]); }
  },
  wool_white(t, r) { wool(t, r, [232, 234, 236]); },
  wool_red(t, r) { wool(t, r, [170, 44, 40]); },
  wool_yellow(t, r) { wool(t, r, [232, 196, 52]); },
  wool_lime(t, r) { wool(t, r, [110, 186, 46]); },
  wool_blue(t, r) { wool(t, r, [54, 72, 170]); },
  wool_black(t, r) { wool(t, r, [30, 30, 36]); },
};

export const TEXTURE_NAMES = Object.keys(GEN);

export function textureIndex(name) {
  const i = TEXTURE_NAMES.indexOf(name);
  if (i < 0) throw new Error(`Unknown texture "${name}"`);
  return i;
}

export function generateTextures() {
  const size = TILE * TILE * 4;
  const data = new Uint8Array(size * TEXTURE_NAMES.length);
  const tiles = {};
  TEXTURE_NAMES.forEach((name, i) => {
    const t = new Uint8ClampedArray(size);
    GEN[name](t, mulberry32(hashString(name)));
    data.set(t, i * size);
    tiles[name] = t;
  });
  return { tileSize: TILE, count: TEXTURE_NAMES.length, data, tiles };
}
