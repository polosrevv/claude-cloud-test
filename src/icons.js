// Inventory icons drawn from the same procedural textures: isometric cubes for
// blocks, flat sprites for everything else. Also the HUD's hearts and food.
import { RENDER_TYPE, RENDER, FACE_TEX, FACE } from './blocks.js';
import { ITEMS } from './items.js';
import { TEXTURE_NAMES, TILE } from './textures.js';

const SIZE = 64;

export function createIconFactory(textures) {
  const tiles = TEXTURE_NAMES.map((name) => {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(textures.tiles[name]), TILE, TILE), 0, 0);
    return c;
  });
  const cache = new Map();

  function blockIcon(id) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const tex = (face) => tiles[FACE_TEX[id * 6 + face]];
    if (RENDER_TYPE[id] === RENDER.CROSS) {
      g.drawImage(tex(0), 8, 8, 48, 48);
      return canvas.toDataURL();
    }
    // Faces of a cube seen from above, laid out on a 48-unit grid.
    const k = SIZE / 48;
    const u = 21 / TILE;
    const slope = 11 / TILE;
    const tall = 22 / TILE;
    const face = (img, a, b, c, d, e, f, shade) => {
      g.setTransform(a * k, b * k, c * k, d * k, e * k, f * k);
      g.drawImage(img, 0, 0);
      if (shade) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(0,0,0,${shade})`;
        g.fillRect(0, 0, TILE, TILE);
        g.globalCompositeOperation = 'source-over';
      }
    };
    face(tex(FACE.SOUTH), u, slope, 0, tall, 3, 14, 0.22);
    face(tex(FACE.EAST), u, -slope, 0, tall, 24, 25, 0.42);
    face(tex(FACE.TOP), u, -slope, u, slope, 3, 14, 0);
    return canvas.toDataURL();
  }

  function spriteIcon(layer) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(tiles[layer], 4, 4, 56, 56);
    return canvas.toDataURL();
  }

  return function icon(key) {
    if (!cache.has(key)) {
      const item = ITEMS[key];
      let url = '';
      if (item) url = item.layer >= 0 ? spriteIcon(item.layer) : blockIcon(item.displayId);
      cache.set(key, url);
    }
    return cache.get(key);
  };
}

// 9x9 pixel HUD icons, scaled up crisply by CSS.
const HEART = ['.##...##.', '#hh#.#hh#', '#hHHHHHh#', '#HHHHHHH#', '.#HHHHH#.', '..#HHH#..', '...#H#...', '....#....'];
const FOOD = ['......##.', '.....#ww#', '....#ww#.', '..##bb#..', '.#bbBb#..', '#bbBBb#..', '#bBBb#...', '.###.....'];
const ARMOR = ['.##...##.', '#ss#.#ss#', '#sssssss#', '#sSsssSs#', '.#sssss#.', '.#sSSSs#.', '..#sss#..', '...###...'];
const BUBBLE = ['..###..', '.#wbb#.', '#wbbbb#', '#bbbbb#', '#bbbbb#', '.#bbb#.', '..###..'];

function drawPixels(rows, palette, half = null) {
  const w = rows[0].length;
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let col = palette[row[x]];
      if (!col) continue;
      if (half === 'left' && x >= Math.ceil(w / 2) && row[x] !== '#') col = palette.empty;
      if (half === 'empty' && row[x] !== '#') col = palette.empty;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

export function hudIcons() {
  const heart = { '#': '#1a0505', h: '#ff8a8a', H: '#d61f1f', empty: '#3a1414' };
  const food = { '#': '#2a1606', w: '#f3efe3', b: '#c9813a', B: '#8f5220', empty: '#3b2814' };
  const armor = { '#': '#202226', s: '#d7dbe0', S: '#9aa1aa', empty: '#2b2e33' };
  const bubble = { '#': '#123a6b', w: '#ffffff', b: '#6fb2ff' };
  return {
    heart: drawPixels(HEART, heart),
    heartHalf: drawPixels(HEART, heart, 'left'),
    heartEmpty: drawPixels(HEART, heart, 'empty'),
    food: drawPixels(FOOD, food),
    foodHalf: drawPixels(FOOD, food, 'left'),
    foodEmpty: drawPixels(FOOD, food, 'empty'),
    armor: drawPixels(ARMOR, armor),
    armorHalf: drawPixels(ARMOR, armor, 'left'),
    armorEmpty: drawPixels(ARMOR, armor, 'empty'),
    bubble: drawPixels(BUBBLE, bubble),
  };
}
