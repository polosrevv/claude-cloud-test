// Isometric inventory icons drawn from the same procedural textures.
import { BLOCKS, RENDER_TYPE, RENDER, FACE_TEX, FACE } from './blocks.js';
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

  function draw(id) {
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

  return function icon(id) {
    if (!cache.has(id)) cache.set(id, draw(id));
    return cache.get(id);
  };
}

export function blockName(id) {
  return BLOCKS[id]?.name ?? '';
}
