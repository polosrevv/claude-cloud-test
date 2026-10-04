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
