// Procedural 64x64 mob skins laid out like Minecraft's box UVs: for a box of
// size (w, h, d) at (u, v), the top is at (u+d, v), the bottom at (u+d+w, v),
// and the sides run +x, front (-z), -x, back (+z) along the row below.
import { mulberry32, hashString } from './noise.js';

export const SKIN = 64;

export function boxRegions(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

function canvas() {
  return new Uint8ClampedArray(SKIN * SKIN * 4);
}

function px(img, x, y, c) {
  if (x < 0 || y < 0 || x >= SKIN || y >= SKIN) return;
  const i = (y * SKIN + x) * 4;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
  img[i + 3] = c[3] ?? 255;
}

// Paint every face of a box. fn(face, x, y, w, h) returns a colour per pixel.
function paintBox(img, u, v, w, h, d, fn) {
  const regions = boxRegions(u, v, w, h, d);
  for (const [face, [x0, y0, rw, rh]] of Object.entries(regions)) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const c = fn(face, x, y, rw, rh);
        if (c) px(img, x0 + x, y0 + y, c);
      }
    }
  }
}

const vary = (r, c, amount = 0.08) => {
  const f = 1 + (r() * 2 - 1) * amount;
  return [c[0] * f, c[1] * f, c[2] * f];
};

function fill(r, c, amount) {
  return () => vary(r, c, amount);
}

const SKINS = {
  pig(img, r) {
    const pink = [236, 160, 158];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if (y === 3 && (x === 1 || x === 6)) return [20, 20, 20];
        if (y === 3 && (x === 0 || x === 7)) return [240, 240, 240];
      }
      return vary(r, pink, 0.05);
    });
    paintBox(img, 16, 16, 4, 3, 1, (face, x, y) => (face === 'front' && y === 1 && (x === 0 || x === 3) ? [120, 60, 60] : vary(r, [244, 140, 140], 0.04)));
    paintBox(img, 28, 8, 10, 16, 8, fill(r, pink, 0.06));
    paintBox(img, 0, 16, 4, 6, 4, (face, x, y) => (y >= 5 ? [110, 70, 60] : vary(r, pink, 0.05)));
  },
  cow(img, r) {
    const spot = (x, y) => Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.7 - x * 0.3) > 0.6;
    const coat = (x, y) => (spot(x, y) ? [236, 236, 230] : vary(r, [56, 42, 34], 0.08));
    paintBox(img, 0, 0, 8, 8, 6, (face, x, y) => {
      if (face === 'front') {
        if (y === 3 && (x === 1 || x === 6)) return [10, 10, 10];
        if (y >= 5 && x >= 2 && x <= 5) return [200, 160, 150];
      }
      return coat(x + 3, y);
    });
    paintBox(img, 22, 0, 1, 3, 1, fill(r, [220, 214, 196], 0.03));
    paintBox(img, 18, 14, 12, 18, 10, (face, x, y) => coat(x, y + (face === 'top' ? 7 : 0)));
    paintBox(img, 0, 16, 4, 12, 4, (face, x, y) => (y >= 10 ? [60, 50, 46] : coat(x * 2, y)));
  },
  sheep(img, r) {
    const wool = [236, 236, 232];
    paintBox(img, 0, 0, 6, 6, 8, (face, x, y) => {
      if (face === 'front' && y === 2 && (x === 1 || x === 4)) return [30, 30, 30];
      return vary(r, [214, 190, 170], 0.05);
    });
    paintBox(img, 28, 8, 8, 16, 6, fill(r, [214, 190, 170], 0.05));
    paintBox(img, 0, 16, 4, 12, 4, (face, x, y) => (y < 6 ? vary(r, wool, 0.04) : vary(r, [214, 190, 170], 0.05)));
    // Wool coat (an inflated copy of the body) and wool cap.
    paintBox(img, 0, 32, 8, 16, 6, () => vary(r, wool, 0.05));
    paintBox(img, 40, 0, 6, 6, 8, (face, x, y) => (face === 'front' && y >= 1 ? null : vary(r, wool, 0.04)));
  },
  chicken(img, r) {
    const white = [244, 244, 240];
    paintBox(img, 0, 0, 4, 6, 3, (face, x, y) => {
      if (face === 'front' && y === 1 && (x === 0 || x === 3)) return [20, 20, 20];
      return vary(r, white, 0.03);
    });
    paintBox(img, 14, 0, 4, 2, 2, fill(r, [250, 186, 40], 0.05));
    paintBox(img, 14, 4, 2, 2, 2, fill(r, [220, 30, 30], 0.05));
    paintBox(img, 0, 9, 6, 6, 8, fill(r, white, 0.04));
    paintBox(img, 24, 13, 1, 4, 6, fill(r, white, 0.04));
    paintBox(img, 26, 0, 1, 5, 1, fill(r, [240, 160, 40], 0.05));
  },
  zombie(img, r) {
    const skin = [90, 150, 80];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if (y === 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return [20, 30, 20];
        if (y === 6 && x >= 2 && x <= 5) return [50, 90, 46];
      }
      if (face === 'top' || (y < 2 && face !== 'bottom')) return vary(r, [60, 110, 56], 0.1);
      return vary(r, skin, 0.08);
    });
    paintBox(img, 16, 16, 8, 12, 4, (face, x, y) => (y > 9 ? vary(r, [40, 60, 150], 0.06) : vary(r, [40, 168, 172], 0.08)));
    paintBox(img, 40, 16, 4, 12, 4, (face, x, y) => (y < 4 ? vary(r, [40, 168, 172], 0.08) : vary(r, skin, 0.08)));
    paintBox(img, 0, 16, 4, 12, 4, (face, x, y) => (y > 9 ? vary(r, [70, 70, 76], 0.06) : vary(r, [44, 62, 156], 0.07)));
  },
  skeleton(img, r) {
    const bone = [210, 210, 204];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if ((y === 3 || y === 4) && (x === 1 || x === 2 || x === 5 || x === 6)) return [30, 30, 30];
        if (y === 6 && x >= 2 && x <= 5 && x % 2 === 0) return [60, 60, 60];
      }
      return vary(r, bone, 0.05);
    });
    paintBox(img, 16, 16, 8, 12, 4, (face, x, y) => (y % 3 === 2 && x > 0 && x < 7 && face !== 'top' ? [60, 60, 60, 0] : vary(r, bone, 0.06)));
    paintBox(img, 40, 16, 2, 12, 2, fill(r, bone, 0.05));
  },
  creeper(img, r) {
    const green = [92, 170, 72];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if ((y === 2 || y === 3) && (x === 1 || x === 2 || x === 5 || x === 6)) return [10, 10, 10];
        if (y === 4 && (x === 3 || x === 4)) return [10, 10, 10];
        if ((y === 5 || y === 6) && x >= 2 && x <= 5) return [10, 10, 10];
        if (y === 7 && (x === 2 || x === 5)) return [10, 10, 10];
      }
      return vary(r, r() < 0.3 ? [140, 200, 120] : green, 0.12);
    });
    paintBox(img, 16, 16, 8, 12, 4, () => vary(r, r() < 0.3 ? [140, 200, 120] : green, 0.12));
    paintBox(img, 0, 16, 4, 6, 4, () => vary(r, r() < 0.3 ? [140, 200, 120] : green, 0.12));
  },
  spider(img, r) {
    const black = [44, 38, 34];
    paintBox(img, 32, 4, 8, 8, 8, (face, x, y) => {
      if (face === 'front' && y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return [220, 30, 30];
      if (face === 'front' && y === 2 && (x === 3 || x === 4)) return [220, 30, 30];
      return vary(r, black, 0.12);
    });
    paintBox(img, 0, 0, 6, 6, 6, fill(r, black, 0.12));
    paintBox(img, 0, 12, 10, 8, 12, (face, x, y) => vary(r, (x + y) % 5 === 0 ? [90, 60, 50] : black, 0.12));
    paintBox(img, 18, 0, 16, 2, 2, fill(r, [60, 50, 44], 0.12));
  },
  enderman(img, r) {
    const black = [22, 18, 26];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front' && y === 4 && (x <= 2 || x >= 5)) return x === 1 || x === 6 ? [240, 160, 255] : [200, 90, 230];
      return vary(r, black, 0.15);
    });
    paintBox(img, 32, 16, 8, 12, 4, fill(r, black, 0.15));
    paintBox(img, 56, 0, 2, 30, 2, fill(r, black, 0.15));
  },
  blaze(img, r) {
    const yellow = [250, 200, 60];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front' && y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return [40, 20, 10];
      return vary(r, r() < 0.3 ? [250, 140, 30] : yellow, 0.08);
    });
    paintBox(img, 0, 16, 2, 8, 2, () => vary(r, r() < 0.5 ? [250, 160, 40] : [200, 100, 20], 0.08));
  },
  dragon(img, r) {
    const scale = (x, y) => vary(r, (x + y * 2) % 4 === 0 ? [44, 40, 52] : [26, 24, 30], 0.12);
    paintBox(img, 0, 0, 12, 12, 16, scale); // body (scaled up on the model)
    paintBox(img, 0, 28, 8, 8, 8, (face, x, y) => {
      if (face === 'front' && y === 2 && (x <= 2 || x >= 5)) return [210, 90, 240];
      return scale(x, y);
    });
    paintBox(img, 32, 28, 6, 3, 8, scale); // snout and jaw
    paintBox(img, 40, 0, 2, 2, 8, scale); // bones and limbs
    for (let y = 44; y < 64; y++) for (let x = 0; x < 64; x++) px(img, x, y, vary(r, [70, 60, 90], 0.12)); // wing membrane
  },
  zombie_pigman(img, r) {
    const pink = [228, 150, 146];
    const rot = [104, 150, 84];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if (y === 3 && (x === 1 || x === 6)) return x === 1 ? [240, 240, 236] : [30, 20, 20];
        if (y >= 5 && y <= 6 && x >= 2 && x <= 5) return y === 5 && (x === 2 || x === 5) ? [110, 50, 50] : [236, 170, 160];
        // One side of the face has rotted to the bone.
        if (x >= 5 && y <= 2) return vary(r, [214, 214, 200], 0.05);
      }
      if (face === 'left' && y < 5) return vary(r, [214, 214, 200], 0.06);
      return vary(r, r() < 0.15 ? rot : pink, 0.06);
    });
    paintBox(img, 16, 16, 8, 12, 4, (face, x, y) => {
      if (y >= 8) return vary(r, [120, 84, 52], 0.06);
      if ((face === 'front' || face === 'back') && y >= 2 && y <= 6 && x >= 1 && x <= 3) return y % 2 ? [200, 200, 186] : [70, 110, 60];
      return vary(r, r() < 0.2 ? rot : pink, 0.06);
    });
    paintBox(img, 40, 16, 4, 12, 4, (face, x, y) => vary(r, y > 9 && x < 2 ? [214, 214, 200] : r() < 0.15 ? rot : pink, 0.06));
    paintBox(img, 0, 16, 4, 12, 4, (face, x, y) => (y < 3 ? vary(r, [120, 84, 52], 0.06) : vary(r, r() < 0.15 ? rot : pink, 0.06)));
  },
  ghast(img, r) { ghastSkin(img, r, false); },
  ghast_fire(img, r) { ghastSkin(img, r, true); },
  wolf(img, r) { wolfSkin(img, r, 'wild'); },
  wolf_tame(img, r) { wolfSkin(img, r, 'tame'); },
  wolf_angry(img, r) { wolfSkin(img, r, 'angry'); },
  slime(img, r) {
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? [96, 180, 80, 190] : vary(r, [120, 200, 100], 0.05).concat(150)));
    paintBox(img, 0, 16, 6, 6, 6, () => vary(r, [80, 160, 66], 0.08));
    paintBox(img, 32, 0, 2, 2, 1, () => [20, 40, 20]);
    paintBox(img, 32, 4, 2, 2, 1, () => [20, 40, 20]);
    paintBox(img, 32, 8, 1, 1, 1, () => [30, 60, 30]);
  },
  squid(img, r) {
    const ink = [34, 52, 80];
    paintBox(img, 0, 0, 12, 16, 12, (face, x, y) => {
      if (face === 'front' && y >= 9 && y <= 10 && (x === 2 || x === 9)) return [230, 230, 230];
      if (face === 'front' && y >= 9 && y <= 10 && (x === 3 || x === 8)) return [20, 20, 30];
      if (face === 'bottom') return vary(r, [90, 110, 140], 0.06);
      return vary(r, (x + y) % 7 === 0 ? [50, 72, 104] : ink, 0.08);
    });
    paintBox(img, 48, 0, 2, 18, 2, (face, x, y) => vary(r, y > 12 ? [80, 100, 130] : ink, 0.08));
  },
  villager_farmer(img, r) { villagerSkin(img, r, [116, 82, 52], [150, 112, 70], null); },
  villager_librarian(img, r) { villagerSkin(img, r, [232, 230, 222], [200, 196, 186], [150, 30, 30]); },
  villager_priest(img, r) { villagerSkin(img, r, [112, 48, 150], [140, 70, 176], [214, 180, 60]); },
  villager_smith(img, r) { villagerSkin(img, r, [66, 62, 60], [90, 86, 82], [26, 24, 24]); },
  villager_butcher(img, r) { villagerSkin(img, r, [236, 234, 228], [210, 206, 198], [170, 40, 40]); },
  iron_golem(img, r) {
    const iron = [206, 200, 192];
    const vine = (x, y) => (Math.sin(x * 1.3 + y * 0.4) > 0.7 && r() < 0.6 ? [70, 120, 40] : null);
    paintBox(img, 0, 0, 18, 12, 11, (face, x, y) => vine(x, y) ?? vary(r, (x + y) % 6 === 0 ? [176, 170, 162] : iron, 0.05));
    paintBox(img, 0, 23, 8, 10, 8, (face, x, y) => {
      if (face === 'front') {
        if (y === 3 && (x === 1 || x === 6)) return [130, 20, 20];
        if (y === 2 && x >= 1 && x <= 6) return [150, 144, 136];
      }
      return vary(r, iron, 0.04);
    });
    paintBox(img, 54, 23, 2, 4, 2, () => vary(r, [190, 184, 176], 0.04));
    paintBox(img, 32, 23, 2, 15, 3, (face, x, y) => vine(x * 3, y) ?? vary(r, y > 12 ? [180, 174, 166] : iron, 0.05));
    paintBox(img, 42, 23, 3, 8, 3, () => vary(r, iron, 0.05));
    paintBox(img, 0, 41, 9, 5, 6, () => vary(r, [170, 164, 156], 0.05));
  },
  boat(img, r) {
    const plank = (x, y) => vary(r, (y % 4 === 3) ? [120, 88, 50] : [164, 124, 74], 0.06);
    paintBox(img, 0, 0, 10, 2, 14, (face, x, y) => plank(x, y + (face === 'top' || face === 'bottom' ? x : 0)));
    paintBox(img, 0, 16, 1, 3, 14, (face, x, y) => plank(x, y));
    paintBox(img, 0, 34, 8, 3, 1, (face, x, y) => plank(x, y));
    paintBox(img, 32, 34, 7, 1, 1, (face, x) => vary(r, x > 4 ? [150, 110, 64] : [110, 80, 46], 0.05));
  },
  magma_cube(img, r) {
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front' && y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return [250, 210, 60];
      return (x + y * 3) % 7 === 0 || y === 4 ? vary(r, [230, 110, 30], 0.1) : vary(r, [60, 18, 14], 0.15);
    });
    paintBox(img, 0, 16, 6, 6, 6, () => vary(r, [250, 150, 40], 0.1));
    paintBox(img, 32, 0, 2, 2, 1, () => [250, 220, 80]);
    paintBox(img, 32, 4, 2, 2, 1, () => [250, 220, 80]);
    paintBox(img, 32, 8, 1, 1, 1, () => [80, 20, 10]);
  },
  wither_skeleton(img, r) {
    const bone = [44, 44, 46];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'front') {
        if ((y === 3 || y === 4) && (x === 1 || x === 2 || x === 5 || x === 6)) return [8, 8, 8];
        if (y === 6 && x >= 2 && x <= 5 && x % 2 === 0) return [16, 16, 16];
      }
      return vary(r, bone, 0.08);
    });
    paintBox(img, 16, 16, 8, 12, 4, (face, x, y) => (y % 3 === 2 && x > 0 && x < 7 && face !== 'top' ? [20, 20, 20, 0] : vary(r, bone, 0.08)));
    paintBox(img, 40, 16, 2, 12, 2, fill(r, bone, 0.08));
  },
  crystal(img, r) {
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? [240, 200, 255, 230] : [220, 120, 240, 120]));
    paintBox(img, 32, 0, 8, 8, 8, () => vary(r, [255, 170, 240], 0.15));
  },
  arrow(img, r) {
    paintBox(img, 0, 0, 1, 1, 14, fill(r, [140, 104, 56], 0.05));
    for (let x = 30; x < 40; x++) for (let y = 0; y < 4; y++) px(img, x, y, [230, 230, 230]);
    for (let x = 40; x < 44; x++) for (let y = 0; y < 4; y++) px(img, x, y, [170, 170, 176]);
  },
  player(img, r) {
    const skin = [214, 160, 124];
    paintBox(img, 0, 0, 8, 8, 8, (face, x, y) => {
      if (face === 'top' || y < 2 || (face === 'back' && y < 7) || ((face === 'left' || face === 'right') && y < 4)) return vary(r, [70, 46, 26], 0.08);
      if (face === 'front' && y === 4 && (x === 1 || x === 6)) return [255, 255, 255];
      if (face === 'front' && y === 4 && (x === 2 || x === 5)) return [60, 70, 160];
      if (face === 'front' && y === 6 && x >= 3 && x <= 4) return [150, 90, 70];
      return vary(r, skin, 0.04);
    });
    paintBox(img, 16, 16, 8, 12, 4, (face, x, y) => (y > 9 ? vary(r, [50, 60, 160], 0.05) : vary(r, [50, 170, 190], 0.06)));
    paintBox(img, 40, 16, 4, 12, 4, (face, x, y) => (y < 4 ? vary(r, [50, 170, 190], 0.06) : vary(r, skin, 0.04)));
    paintBox(img, 0, 16, 4, 12, 4, (face, x, y) => (y > 10 ? vary(r, [80, 80, 86], 0.05) : vary(r, [50, 60, 160], 0.05)));
  },
};

function villagerSkin(img, r, robe, robeLight, trim) {
  const skin = [196, 146, 108];
  paintBox(img, 0, 0, 8, 10, 8, (face, x, y) => {
    if (face === 'front') {
      if (y === 4 && (x === 1 || x === 6)) return [255, 255, 255];
      if (y === 4 && (x === 2 || x === 5)) return [40, 120, 60];
      if (y === 3 && x >= 1 && x <= 6) return [90, 60, 40];
      if (y >= 7 && x >= 2 && x <= 5) return vary(r, [176, 128, 92], 0.04);
    }
    if (face === 'top') return vary(r, [180, 132, 96], 0.05);
    return vary(r, skin, 0.04);
  });
  paintBox(img, 32, 0, 2, 4, 2, () => vary(r, [186, 134, 98], 0.04));
  paintBox(img, 16, 20, 8, 12, 6, (face, x, y) => (trim && (face === 'front' || face === 'back') && x >= 3 && x <= 4 ? trim : vary(r, robe, 0.05)));
  paintBox(img, 0, 38, 8, 18, 6, (face, x, y) => {
    if (trim && face === 'front' && y >= 2 && y <= 12 && x >= 2 && x <= 5) return vary(r, trim, 0.05);
    return vary(r, y > 15 ? robeLight : robe, 0.05);
  });
  paintBox(img, 44, 22, 4, 8, 4, (face, x, y) => (y > 5 ? vary(r, skin, 0.04) : vary(r, robe, 0.05)));
  paintBox(img, 40, 38, 8, 4, 4, () => vary(r, robe, 0.05));
  paintBox(img, 0, 22, 4, 12, 4, (face, x, y) => vary(r, y > 9 ? [60, 46, 36] : robe, 0.05));
}

function ghastSkin(img, r, firing) {
  const white = [240, 240, 240];
  paintBox(img, 0, 0, 16, 16, 16, (face, x, y) => {
    if (face === 'front') {
      // Closed, crying eyes; wide open and red-rimmed when it fires.
      const eye = (x >= 3 && x <= 5) || (x >= 10 && x <= 12);
      if (firing) {
        if (eye && y >= 5 && y <= 7) return y === 6 && (x === 4 || x === 11) ? [140, 20, 20] : [30, 30, 30];
        if (y >= 10 && y <= 13 && x >= 5 && x <= 10) return [40, 20, 20];
      } else {
        if (eye && y === 6) return [70, 70, 70];
        if ((x === 4 || x === 11) && y >= 7 && y <= 9) return [170, 190, 200];
        if (y === 11 && x >= 6 && x <= 9) return [70, 70, 70];
      }
    }
    return vary(r, white, 0.03);
  });
  paintBox(img, 0, 32, 2, 9, 2, () => vary(r, white, 0.04));
}

function wolfSkin(img, r, mood) {
  const fur = [214, 210, 204];
  const back = [170, 162, 152];
  paintBox(img, 0, 0, 6, 6, 4, (face, x, y) => {
    if (face === 'front') {
      if (y === 2 && (x === 1 || x === 4)) return mood === 'angry' ? [200, 30, 30] : [30, 30, 30];
      if (mood === 'angry' && y === 1 && (x === 1 || x === 4)) return [120, 120, 120];
    }
    return vary(r, face === 'top' ? back : fur, 0.05);
  });
  paintBox(img, 16, 14, 2, 2, 1, () => vary(r, back, 0.05));
  paintBox(img, 0, 10, 3, 3, 4, (face, x, y) => (face === 'front' && y === 0 && x === 1 ? [30, 30, 30] : vary(r, fur, 0.05)));
  paintBox(img, 18, 14, 6, 9, 6, (face, x, y) => vary(r, face === 'top' || (face !== 'bottom' && y < 2) ? back : fur, 0.06));
  paintBox(img, 21, 0, 8, 6, 7, (face, x, y) => {
    // The tamed wolf wears a red collar where the mane meets the head.
    if (mood === 'tame' && y >= 4 && face !== 'top' && face !== 'bottom') return [190, 30, 30];
    return vary(r, face === 'top' ? back : fur, 0.06);
  });
  paintBox(img, 9, 18, 2, 8, 2, (face, x, y) => vary(r, y > 5 ? [250, 250, 248] : fur, 0.05));
  paintBox(img, 0, 18, 2, 8, 2, () => vary(r, fur, 0.05));
}

export const SKIN_NAMES = Object.keys(SKINS);

export function generateSkins() {
  const size = SKIN * SKIN * 4;
  const data = new Uint8Array(size * SKIN_NAMES.length);
  SKIN_NAMES.forEach((name, i) => {
    const img = canvas();
    SKINS[name](img, mulberry32(hashString(`skin-${name}`)));
    data.set(img, i * size);
  });
  return { size: SKIN, count: SKIN_NAMES.length, data };
}
