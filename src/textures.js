// Procedural 16x16 pixel-art textures. Each tile is drawn from its own seeded
// RNG, so the look is identical on every load and no image files are needed.
import { mulberry32, hashString } from './noise.js';
import { buildItemArt } from './sprites.js';

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


function clear(t) {
  for (let i = 3; i < t.length; i += 4) t[i] = 0;
}

function rect(t, x0, y0, x1, y1, c, r, amount = 0.05, a = 255) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) put(t, x, y, r ? mul(c, jitter(r, amount)) : c, a);
  }
}

// Draws an ASCII picture: each character maps to a colour in the palette
// (or is skipped when it isn't in the palette).
export function art(t, r, rows, palette, amount = 0.06) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]];
      if (c) put(t, x, y, r ? mul(c, jitter(r, amount)) : c, c[3] ?? 255);
    }
  });
}

function framed(t, r, base, edge) {
  noiseFill(t, r, base, 0.05);
  for (let i = 0; i < TILE; i++) {
    put(t, i, 0, mul(edge, jitter(r, 0.05)));
    put(t, i, 15, mul(edge, jitter(r, 0.05)));
    put(t, 0, i, mul(edge, jitter(r, 0.05)));
    put(t, 15, i, mul(edge, jitter(r, 0.05)));
  }
}

function metalBlock(t, r, c) {
  noiseFill(t, r, c, 0.03);
  for (let i = 0; i < TILE; i++) {
    put(t, i, 0, mul(c, 1.25)); put(t, 0, i, mul(c, 1.2));
    put(t, i, 15, mul(c, 0.7)); put(t, 15, i, mul(c, 0.75));
    put(t, i, 1, mul(c, 1.1)); put(t, 14, i, mul(c, 0.85));
  }
}

function planksOf(t, r, base) {
  const seams = [3, 11, 7, 14];
  for (let y = 0; y < TILE; y++) {
    const board = y >> 2;
    const tone = 0.9 + ((board * 37) % 5) * 0.03;
    for (let x = 0; x < TILE; x++) {
      let f = tone * jitter(r, 0.04);
      if (y % 4 === 3) f = 0.62;
      else if (x === seams[board]) f = 0.68;
      else if (r() < 0.1) f *= 0.86;
      put(t, x, y, mul(base, f));
    }
  }
}

function crop(t, r, stage) {
  clear(t);
  const h = 3 + Math.round(stage * 1.7);
  const ripe = stage / 7;
  const green = [70 + 110 * ripe, 150 - 10 * ripe, 40];
  for (const x of [2, 5, 8, 11, 14]) {
    const lean = r() < 0.5 ? -1 : 1;
    for (let k = 0; k < h; k++) put(t, x + (k > h * 0.6 ? lean : 0), 15 - k, mul(green, 0.8 + r() * 0.3));
    if (stage >= 5) for (let k = h - 3; k < h; k++) put(t, x + lean, 15 - k, mul([214, 180, 70], 0.85 + r() * 0.25));
  }
}

function sapling(t, r, leaf, trunk) {
  clear(t);
  for (let y = 9; y < TILE; y++) put(t, 7, y, mul(trunk, jitter(r, 0.1)));
  for (let y = 2; y < 11; y++) {
    for (let x = 3; x < 13; x++) {
      if (Math.hypot(x - 7.5, (y - 6) * 1.2) < 4.6 && r() < 0.85) put(t, x, y, mul(leaf, 0.75 + r() * 0.45));
    }
  }
}

function cracks(t, stage) {
  clear(t);
  const r = mulberry32(777);
  const segments = [];
  for (let s = 0; s < 40; s++) {
    let x = 7.5;
    let y = 7.5;
    const a = r() * Math.PI * 2;
    const len = 2 + r() * 5;
    const path = [];
    for (let k = 0; k < len; k++) {
      x += Math.cos(a) + (r() - 0.5) * 0.8;
      y += Math.sin(a) + (r() - 0.5) * 0.8;
      path.push([Math.round(x), Math.round(y)]);
    }
    segments.push(path);
  }
  const shown = 2 + stage * 2;
  for (let s = 0; s < shown; s++) {
    const path = segments[s];
    const keep = Math.ceil(path.length * Math.min(1, 0.35 + stage * 0.08));
    for (let k = 0; k < keep; k++) put(t, path[k][0], path[k][1], [24, 24, 24], 190);
  }
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
  lapis_ore(t, r) { ore(t, r, [34, 76, 196], 5); },
  emerald_ore(t, r) { ore(t, r, [40, 200, 90], 3); },
  emerald_block(t, r) {
    noiseFill(t, r, [60, 210, 110], 0.06);
    for (let k = 0; k < TILE; k++) { put(t, k, 0, [140, 240, 170]); put(t, 0, k, [140, 240, 170]); put(t, k, 15, [20, 120, 60]); put(t, 15, k, [20, 120, 60]); }
    rect(t, 4, 4, 11, 11, [30, 160, 80], r, 0.06);
    rect(t, 6, 6, 9, 9, [120, 240, 160], r, 0.04);
  },
  lapis_block(t, r) {
    noiseFill(t, r, [30, 64, 170], 0.08);
    for (let i = 0; i < 18; i++) put(t, (r() * TILE) | 0, (r() * TILE) | 0, mul([70, 110, 220], jitter(r, 0.1)));
    for (let i = 0; i < 10; i++) put(t, (r() * TILE) | 0, (r() * TILE) | 0, [214, 180, 60]);
    for (let k = 0; k < TILE; k++) {
      put(t, k, 0, [22, 46, 128]);
      put(t, 0, k, [22, 46, 128]);
      put(t, k, 15, [16, 34, 100]);
      put(t, 15, k, [16, 34, 100]);
    }
  },
  enchanting_table_top(t, r) {
    noiseFill(t, r, [150, 30, 36], 0.08);
    for (let k = 0; k < TILE; k++) {
      put(t, k, 0, [30, 22, 40]); put(t, k, 15, [30, 22, 40]);
      put(t, 0, k, [30, 22, 40]); put(t, 15, k, [30, 22, 40]);
    }
    for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) rect(t, x, y, x + 1, y + 1, [92, 226, 218], r, 0.06);
    // A thin gold border around the cloth.
    for (let k = 3; k < 13; k++) {
      put(t, k, 3, [214, 170, 60]); put(t, k, 12, [214, 170, 60]);
      put(t, 3, k, [214, 170, 60]); put(t, 12, k, [214, 170, 60]);
    }
  },
  enchanting_table_side(t, r) {
    GEN.obsidian(t, r);
    rect(t, 0, 4, 15, 6, [150, 30, 36], r, 0.08);
    for (let k = 0; k < TILE; k += 3) put(t, k, 6, [214, 170, 60]);
    put(t, 2, 10, [92, 226, 218]); put(t, 13, 10, [92, 226, 218]);
  },
  enchanting_book(t, r) {
    noiseFill(t, r, [120, 52, 30], 0.08);
    rect(t, 0, 0, 15, 2, [236, 226, 196], r, 0.03);
    rect(t, 7, 0, 8, 15, [70, 30, 18], r, 0.03);
  },
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
  wool_orange(t, r) { wool(t, r, [226, 128, 40]); },
  wool_magenta(t, r) { wool(t, r, [186, 70, 186]); },
  wool_light_blue(t, r) { wool(t, r, [96, 146, 214]); },
  wool_pink(t, r) { wool(t, r, [228, 146, 170]); },
  wool_gray(t, r) { wool(t, r, [66, 66, 70]); },
  wool_light_gray(t, r) { wool(t, r, [152, 152, 156]); },
  wool_cyan(t, r) { wool(t, r, [40, 128, 146]); },
  wool_purple(t, r) { wool(t, r, [124, 56, 176]); },
  wool_green(t, r) { wool(t, r, [70, 96, 30]); },
  wool_brown(t, r) { wool(t, r, [104, 68, 40]); },
  iron_bars(t, r) {
    clear(t);
    for (const x of [1, 5, 10, 14]) for (let y = 0; y < TILE; y++) put(t, x, y, mul(y % 5 === 0 ? [180, 182, 186] : [124, 126, 130], jitter(r, 0.05)));
    for (const y of [0, 15]) for (let x = 0; x < TILE; x++) put(t, x, y, mul([110, 112, 116], jitter(r, 0.05)));
  },
  pumpkin_side(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const rib = x % 4 === 0 ? 0.78 : x % 4 === 2 ? 1.05 : 0.93;
        put(t, x, y, mul([214, 120, 24], rib * jitter(r, 0.04)));
      }
    }
  },
  pumpkin_top(t, r) {
    GEN.pumpkin_side(t, r);
    rect(t, 6, 6, 9, 9, [96, 80, 30], r, 0.08);
    rect(t, 7, 7, 8, 8, [70, 110, 30], r, 0.08);
  },
  pumpkin_face(t, r) {
    GEN.pumpkin_side(t, r);
    art(t, null, ['', '', '', '',
      '...XX......XX...',
      '...XXX....XXX...',
      '................',
      '.......XX.......',
      '................',
      '..XXXXXXXXXXXX..',
      '..XX.XXXXXX.XX..',
      '....XX....XX....',
    ], { X: [66, 34, 10] });
  },
  jack_o_lantern_face(t, r) {
    GEN.pumpkin_side(t, r);
    art(t, null, ['', '', '', '',
      '...XX......XX...',
      '...XXX....XXX...',
      '................',
      '.......XX.......',
      '................',
      '..XXXXXXXXXXXX..',
      '..XX.XXXXXX.XX..',
      '....XX....XX....',
    ], { X: [255, 226, 90] });
  },
  melon_side(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const stripe = (x + Math.floor(Math.sin(y * 0.8) * 1.2) + 16) % 4 < 2;
        put(t, x, y, mul(stripe ? [96, 158, 40] : [148, 190, 52], jitter(r, 0.05)));
      }
    }
  },
  melon_top(t, r) {
    noiseFill(t, r, [128, 176, 46], 0.06);
    for (let a = 0; a < 6; a++) {
      for (let k = 0; k < 8; k++) put(t, Math.round(7.5 + Math.cos(a) * k), Math.round(7.5 + Math.sin(a) * k), [92, 150, 36]);
    }
  },
  ...Object.fromEntries(Array.from({ length: 8 }, (_, stage) => [`stem_${stage}`, (t, r) => {
    clear(t);
    const h = 2 + Math.round(stage * 1.7);
    const c = stage === 7 ? [170, 160, 60] : [90 + stage * 8, 160, 50];
    for (let k = 0; k < h; k++) put(t, 7 + (k % 5 === 4 ? 1 : 0), 15 - k, mul(c, jitter(r, 0.06)));
    if (stage > 2) {
      put(t, 6, 15 - Math.floor(h / 2), mul(c, 0.9));
      put(t, 9, 14 - Math.floor(h / 3), mul(c, 0.9));
    }
  }])),
  brown_mushroom(t, r) {
    clear(t);
    rect(t, 7, 9, 8, 14, [222, 206, 180], r, 0.04);
    for (let y = 6; y <= 9; y++) for (let x = 4; x <= 11; x++) if (Math.hypot(x - 7.5, (y - 9) * 1.6) < 4.2) put(t, x, y, mul([150, 110, 80], jitter(r, 0.06)));
  },
  red_mushroom(t, r) {
    clear(t);
    rect(t, 7, 10, 8, 14, [226, 220, 204], r, 0.04);
    for (let y = 5; y <= 10; y++) {
      for (let x = 4; x <= 11; x++) {
        if (Math.hypot(x - 7.5, (y - 9.5) * 1.1) < 4.6) put(t, x, y, (x + y * 3) % 7 === 0 ? [240, 236, 228] : mul([200, 32, 30], jitter(r, 0.06)));
      }
    }
  },
  cake_top(t, r) {
    noiseFill(t, r, [244, 240, 236], 0.03);
    for (let i = 0; i < 9; i++) put(t, 2 + ((r() * 12) | 0), 2 + ((r() * 12) | 0), [214, 40, 40]);
  },
  cake_side(t, r) {
    clear(t);
    rect(t, 0, 8, 15, 15, [176, 112, 64], r, 0.05);
    rect(t, 0, 8, 15, 9, [244, 240, 236], r, 0.02);
    for (let x = 0; x < TILE; x += 3) put(t, x, 10, [244, 240, 236]);
  },
  cake_inner(t, r) {
    clear(t);
    rect(t, 0, 8, 15, 15, [222, 186, 120], r, 0.06);
    rect(t, 0, 8, 15, 9, [244, 240, 236], r, 0.02);
    rect(t, 0, 12, 15, 12, [200, 50, 50], r, 0.05);
  },
  cake_bottom(t, r) { noiseFill(t, r, [176, 112, 64], 0.05); },

  // ----- added for survival -----
  lava(t, r) {
    noiseFill(t, r, [214, 92, 18], 0.08);
    voronoi(r, 7, (x, y, n, edge) => {
      if (edge < 1.2) put(t, x, y, mul([255, 196, 60], jitter(r, 0.08)));
      else if (edge > 3) put(t, x, y, mul([176, 54, 12], jitter(r, 0.08)));
    });
  },
  birch_planks(t, r) { planksOf(t, r, [200, 176, 122]); },
  spruce_planks(t, r) { planksOf(t, r, [116, 86, 52]); },
  torch(t, r) {
    clear(t);
    for (let y = 8; y < TILE; y++) { put(t, 7, y, mul([118, 86, 44], jitter(r, 0.08))); put(t, 8, y, mul([92, 64, 32], jitter(r, 0.08))); }
    put(t, 7, 6, [255, 236, 140]); put(t, 8, 6, [255, 206, 80]);
    put(t, 7, 7, [255, 170, 40]); put(t, 8, 7, [236, 120, 24]);
  },
  furnace_side(t, r) {
    GEN.stone(t, r);
    for (let i = 0; i < TILE; i++) { put(t, i, 0, [96, 96, 96]); put(t, i, 15, [84, 84, 84]); }
  },
  furnace_top(t, r) { framed(t, r, [132, 132, 132], [96, 96, 96]); },
  furnace_front(t, r) {
    GEN.cobblestone(t, r);
    rect(t, 3, 8, 12, 13, [22, 22, 22], r, 0.15);
    rect(t, 3, 7, 12, 7, [70, 70, 70], r);
    rect(t, 3, 14, 12, 14, [70, 70, 70], r);
  },
  furnace_front_lit(t, r) {
    GEN.furnace_front(t, r);
    for (let x = 4; x <= 11; x++) {
      const h = 2 + ((r() * 4) | 0);
      for (let k = 0; k < h; k++) put(t, x, 13 - k, k === h - 1 ? [255, 220, 90] : [240, 120 + k * 30, 30]);
    }
  },
  chest_front(t, r) {
    framed(t, r, [156, 112, 52], [86, 58, 26]);
    rect(t, 1, 5, 14, 5, [74, 50, 22], r);
    rect(t, 7, 3, 8, 7, [190, 190, 196], r, 0.03);
    put(t, 7, 6, [60, 60, 66]); put(t, 8, 6, [60, 60, 66]);
  },
  chest_side(t, r) {
    framed(t, r, [150, 106, 48], [86, 58, 26]);
    rect(t, 1, 5, 14, 5, [74, 50, 22], r);
  },
  chest_top(t, r) { framed(t, r, [160, 116, 56], [86, 58, 26]); },
  bed_head_top(t, r) {
    noiseFill(t, r, [170, 34, 34], 0.05);
    rect(t, 2, 1, 13, 6, [236, 236, 230], r, 0.03);
    rect(t, 2, 6, 13, 6, [200, 200, 196], r, 0.03);
  },
  bed_foot_top(t, r) {
    noiseFill(t, r, [170, 34, 34], 0.05);
    rect(t, 0, 13, 15, 13, [130, 24, 24], r);
  },
  bed_side(t, r) {
    noiseFill(t, r, [170, 34, 34], 0.05);
    rect(t, 0, 12, 15, 15, [140, 100, 54], r);
    for (let i = 3; i <= 12; i++) { put(t, i, 14, [0, 0, 0], 0); put(t, i, 15, [0, 0, 0], 0); }
  },
  door_lower(t, r) {
    planksOf(t, r, [150, 116, 66]);
    for (let y = 0; y < TILE; y++) { put(t, 0, y, [96, 70, 36]); put(t, 15, y, [96, 70, 36]); }
    rect(t, 0, 15, 15, 15, [96, 70, 36]);
    rect(t, 3, 3, 12, 12, [130, 98, 54], r, 0.04);
    put(t, 12, 1, [60, 60, 60]); put(t, 12, 2, [60, 60, 60]);
  },
  door_upper(t, r) {
    planksOf(t, r, [150, 116, 66]);
    for (let y = 0; y < TILE; y++) { put(t, 0, y, [96, 70, 36]); put(t, 15, y, [96, 70, 36]); }
    rect(t, 0, 0, 15, 0, [96, 70, 36]);
    for (const [x0, x1] of [[2, 6], [9, 13]]) {
      for (let y = 3; y <= 9; y++) for (let x = x0; x <= x1; x++) put(t, x, y, [0, 0, 0], 0);
    }
  },
  farmland(t, r) {
    noiseFill(t, r, [92, 60, 36], 0.08);
    for (let y = 0; y < TILE; y += 4) rect(t, 0, y, 15, y, [64, 40, 22], r, 0.08);
  },
  wheat_0(t, r) { crop(t, r, 0); },
  wheat_1(t, r) { crop(t, r, 1); },
  wheat_2(t, r) { crop(t, r, 2); },
  wheat_3(t, r) { crop(t, r, 3); },
  wheat_4(t, r) { crop(t, r, 4); },
  wheat_5(t, r) { crop(t, r, 5); },
  wheat_6(t, r) { crop(t, r, 6); },
  wheat_7(t, r) { crop(t, r, 7); },
  oak_sapling(t, r) { sapling(t, r, [60, 132, 40], [104, 82, 50]); },
  birch_sapling(t, r) { sapling(t, r, [110, 156, 66], [218, 216, 208]); },
  spruce_sapling(t, r) { sapling(t, r, [44, 96, 62], [74, 54, 32]); },
  sugar_cane(t, r) {
    clear(t);
    for (const x of [3, 7, 11]) {
      for (let y = 0; y < TILE; y++) {
        const joint = (y + x) % 5 === 0;
        put(t, x, y, mul(joint ? [150, 196, 110] : [118, 176, 80], jitter(r, 0.06)));
        put(t, x + 1, y, mul([96, 150, 64], jitter(r, 0.06)));
      }
    }
  },
  clay(t, r) { noiseFill(t, r, [160, 166, 180], 0.05); specks(t, r, [160, 166, 180], 20, 0.9, 1.06); },
  iron_block(t, r) { metalBlock(t, r, [220, 220, 222]); },
  gold_block(t, r) { metalBlock(t, r, [246, 208, 62]); },
  diamond_block(t, r) { metalBlock(t, r, [104, 224, 220]); },
  tnt_side(t, r) {
    noiseFill(t, r, [204, 52, 36], 0.05);
    rect(t, 0, 5, 15, 10, [232, 232, 226], r, 0.03);
    art(t, null, ['', '', '', '', '', '', '.XXX.X..X.XXX..', '..X..XX.X..X...', '..X..X.XX..X...', '..X..X..X..X...'], { X: [30, 30, 30] });
  },
  tnt_top(t, r) {
    noiseFill(t, r, [204, 52, 36], 0.05);
    rect(t, 6, 6, 9, 9, [60, 60, 60], r);
  },
  tnt_bottom(t, r) { noiseFill(t, r, [180, 46, 32], 0.05); },
  fire(t, r) {
    clear(t);
    for (let x = 0; x < TILE; x++) {
      const h = 6 + ((r() * 10) | 0);
      for (let k = 0; k < h; k++) {
        const f = k / h;
        const c = f < 0.4 ? [255, 236, 120] : f < 0.75 ? [250, 150, 40] : [220, 70, 20];
        if (k === h - 1 && r() < 0.5) continue;
        put(t, x, 15 - k, mul(c, jitter(r, 0.08)));
      }
    }
  },
  netherrack(t, r) {
    noiseFill(t, r, [112, 40, 40], 0.1);
    specks(t, r, [112, 40, 40], 40, 0.7, 1.25);
  },
  soul_sand(t, r) {
    noiseFill(t, r, [86, 66, 52], 0.08);
    for (let i = 0; i < 4; i++) {
      const x = 1 + ((r() * 11) | 0);
      const y = 1 + ((r() * 11) | 0);
      put(t, x, y, [44, 32, 26]); put(t, x + 2, y, [44, 32, 26]); put(t, x + 1, y + 2, [44, 32, 26]);
    }
  },
  nether_quartz_ore(t, r) {
    GEN.netherrack(t, r);
    for (let i = 0; i < 6; i++) {
      const x = (r() * 14) | 0;
      const y = (r() * 14) | 0;
      put(t, x, y, [236, 228, 220]); put(t, x + 1, y, [210, 200, 192]); put(t, x, y + 1, [200, 190, 182]);
    }
  },
  nether_bricks(t, r) {
    for (let y = 0; y < TILE; y++) {
      const row = y >> 2;
      const off = (row % 2) * 4;
      for (let x = 0; x < TILE; x++) {
        if (y % 4 === 3 || (x + off) % 8 === 7) put(t, x, y, mul([30, 14, 18], jitter(r, 0.1)));
        else put(t, x, y, mul([68, 30, 36], jitter(r, 0.08)));
      }
    }
  },
  nether_portal(t, r) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const swirl = Math.sin((x + y * 0.6) * 0.9 + Math.cos(y * 0.7) * 2);
        const f = 0.7 + swirl * 0.25 + (r() - 0.5) * 0.15;
        put(t, x, y, mul([130, 50, 220], f), 180);
      }
    }
  },
  end_stone(t, r) {
    noiseFill(t, r, [222, 222, 164], 0.05);
    specks(t, r, [222, 222, 164], 30, 0.82, 1.06);
  },
  end_portal_frame_top(t, r) {
    framed(t, r, [70, 112, 92], [44, 76, 62]);
    rect(t, 4, 4, 11, 11, [28, 44, 40], r, 0.05);
  },
  end_portal_frame_side(t, r) {
    GEN.end_stone(t, r);
    rect(t, 0, 3, 15, 5, [64, 104, 86], r, 0.05);
  },
  end_portal_eye(t, r) {
    noiseFill(t, r, [60, 160, 90], 0.08);
    rect(t, 5, 5, 10, 10, [30, 90, 60], r);
    rect(t, 7, 7, 8, 8, [10, 10, 10]);
  },
  end_portal(t, r) {
    noiseFill(t, r, [10, 14, 22], 0.2);
    for (let i = 0; i < 18; i++) {
      const c = [[90, 220, 200], [200, 120, 240], [120, 160, 255]][(r() * 3) | 0];
      put(t, (r() * 16) | 0, (r() * 16) | 0, c);
    }
  },
  dragon_egg(t, r) {
    noiseFill(t, r, [22, 14, 30], 0.15);
    specks(t, r, [120, 60, 160], 18, 1, 1);
  },
  spawner(t, r) {
    clear(t);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (x % 5 === 0 || y % 5 === 0 || x === 15 || y === 15) put(t, x, y, mul([40, 46, 56], jitter(r, 0.15)));
      }
    }
  },
  stone_slab_top(t, r) { framed(t, r, [168, 168, 168], [130, 130, 130]); },
  stone_slab_side(t, r) {
    noiseFill(t, r, [160, 160, 160], 0.04);
    rect(t, 0, 7, 15, 8, [118, 118, 118], r);
    rect(t, 0, 15, 15, 15, [118, 118, 118], r);
  },
  ladder(t, r) {
    clear(t);
    for (let y = 0; y < TILE; y++) {
      put(t, 2, y, mul([128, 96, 52], jitter(r, 0.08))); put(t, 3, y, mul([104, 78, 40], jitter(r, 0.08)));
      put(t, 12, y, mul([128, 96, 52], jitter(r, 0.08))); put(t, 13, y, mul([104, 78, 40], jitter(r, 0.08)));
    }
    for (const y of [2, 6, 10, 14]) rect(t, 4, y, 11, y, [140, 104, 58], r, 0.08);
  },
  ice(t, r) {
    noiseFill(t, r, [150, 186, 244], 0.05, 190);
    for (let i = 0; i < 6; i++) {
      const x = (r() * 12) | 0;
      const y = (r() * 12) | 0;
      put(t, x, y, [230, 244, 255], 210); put(t, x + 1, y + 1, [230, 244, 255], 210); put(t, x + 2, y + 2, [230, 244, 255], 210);
    }
  },
  destroy_0(t) { cracks(t, 0); },
  destroy_1(t) { cracks(t, 1); },
  destroy_2(t) { cracks(t, 2); },
  destroy_3(t) { cracks(t, 3); },
  destroy_4(t) { cracks(t, 4); },
  destroy_5(t) { cracks(t, 5); },
  destroy_6(t) { cracks(t, 6); },
  destroy_7(t) { cracks(t, 7); },
  destroy_8(t) { cracks(t, 8); },
  destroy_9(t) { cracks(t, 9); },
  particle_smoke(t, r) {
    clear(t);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < 6.5) put(t, x, y, mul([200, 200, 200], 0.8 + r() * 0.3));
      }
    }
  },
  particle_white(t) { for (let i = 0; i < t.length; i++) t[i] = 255; },
  bobber(t) {
    clear(t);
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        if (Math.hypot(x - 7.5, y - 7.5) < 3.8) put(t, x, y, y < 8 ? [220, 40, 40] : [240, 240, 240]);
      }
    }
    put(t, 7, 3, [60, 60, 60]); put(t, 8, 3, [60, 60, 60]);
  },
  xp_orb(t, r) {
    clear(t);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < 4.6) put(t, x, y, d < 2.2 ? [250, 255, 170] : d < 3.6 ? mul([196, 238, 70], jitter(r, 0.05)) : [92, 128, 20]);
      }
    }
  },
  // Weather tiles repeat vertically: streaks of rain and loose snowflakes.
  weather_rain(t, r) {
    clear(t);
    for (let i = 0; i < 3; i++) {
      const x = (i * 5 + Math.floor(r() * 4)) % TILE;
      const y0 = Math.floor(r() * TILE);
      const len = 4 + Math.floor(r() * 5);
      for (let k = 0; k < len; k++) put(t, x, (y0 + k) % TILE, mul([168, 190, 232], 0.85 + r() * 0.2), 120 + k * 18);
    }
  },
  weather_snow(t, r) {
    clear(t);
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(r() * 15);
      const y = Math.floor(r() * 15);
      put(t, x, y, [250, 250, 255], 235);
      if (r() < 0.6) put(t, x + 1, y, [236, 240, 250], 200);
      if (r() < 0.6) put(t, x, y + 1, [236, 240, 250], 200);
    }
  },
  arm(t, r) {
    noiseFill(t, r, [214, 160, 124], 0.03);
    rect(t, 0, 0, 15, 5, [60, 170, 190], r, 0.04);
  },
};

Object.assign(GEN, buildItemArt({ put, mul, jitter, clear, art }));

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
