// 16x16 item sprites (tools, armour, food, materials), drawn in code like the
// block textures. Each entry receives the tile, a seeded RNG and helpers.

const MATERIALS = {
  wooden: [150, 112, 60],
  stone: [128, 128, 128],
  iron: [214, 214, 214],
  golden: [246, 208, 62],
  diamond: [92, 222, 214],
  leather: [150, 90, 48],
};

const TOOLS = {
  sword: [
    '................',
    '............ooo.',
    '...........o##o.',
    '..........o#l#o.',
    '.........o#l#o..',
    '........o#l#o...',
    '.......o#l#o....',
    '..oo..o#l#o.....',
    '..o#oo#l#o......',
    '...o#o##o.......',
    '...oo/oo........',
    '..o/so#o........',
    '.o/so.oo........',
    'o/so............',
    'oso.............',
    '................',
  ],
  pickaxe: [
    '................',
    '....oooooo......',
    '...o#l####oo....',
    '..o#l#oooo##o...',
    '..ooo....o/##o..',
    '........o/so#o..',
    '.......o/so.o#o.',
    '......o/so..o#o.',
    '.....o/so....oo.',
    '....o/so........',
    '...o/so.........',
    '..o/so..........',
    '.o/so...........',
    'o/so............',
    'oso.............',
    '................',
  ],
  axe: [
    '................',
    '......oo........',
    '.....o##o.......',
    '....o#l##o......',
    '...o#l####o.....',
    '...o#l###/so....',
    '...o####/so.....',
    '....oo#/so......',
    '.....o/so.......',
    '....o/so........',
    '...o/so.........',
    '..o/so..........',
    '.o/so...........',
    'o/so............',
    'oso.............',
    '................',
  ],
  shovel: [
    '................',
    '...........oo...',
    '..........o#lo..',
    '.........o#l##o.',
    '........o#l###o.',
    '........o####o..',
    '.......o/ooo....',
    '......o/so......',
    '.....o/so.......',
    '....o/so........',
    '...o/so.........',
    '..o/so..........',
    '.o/so...........',
    'o/so............',
    'oso.............',
    '................',
  ],
  hoe: [
    '................',
    '.....oooooo.....',
    '....o#l####oo...',
    '.....oooooo/so..',
    '..........o/so..',
    '.........o/so...',
    '........o/so....',
    '.......o/so.....',
    '......o/so......',
    '.....o/so.......',
    '....o/so........',
    '...o/so.........',
    '..o/so..........',
    '.o/so...........',
    '.oo.............',
    '................',
  ],
};

const ARMOR = {
  helmet: [
    '', '', '',
    '....oooooooo....',
    '...o#l######o...',
    '...o#l######o...',
    '...o##oooo##o...',
    '...o#o....o#o...',
    '...ooo....ooo...',
  ],
  chestplate: [
    '',
    '..ooo......ooo..',
    '..o#o......o#o..',
    '..o#oooooooo#o..',
    '..o#l########o..',
    '..oo#l######oo..',
    '...o#l######o...',
    '...o########o...',
    '...o########o...',
    '...o########o...',
    '...o########o...',
    '...oooooooooo...',
  ],
  leggings: [
    '', '',
    '...oooooooooo...',
    '...o#l######o...',
    '...o########o...',
    '...o#l#oo###o...',
    '...o###oo###o...',
    '...o#l#oo###o...',
    '...o###oo###o...',
    '...o###oo###o...',
    '...o###oo###o...',
    '...ooooooooooo..',
  ],
  boots: [
    '', '', '', '', '', '',
    '...ooo....ooo...',
    '...o#o....o#o...',
    '...o#o....o#o...',
    '..oo#o....o#oo..',
    '.o#l#o....o#l#o.',
    '.ooooo....ooooo.',
  ],
};

export function buildItemArt({ put, mul, jitter, clear, art }) {
  const disk = (t, r, cx, cy, rx, ry, c, amount = 0.08) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) put(t, x, y, mul(c, jitter(r, amount)));
      }
    }
  };
  const line = (t, r, x0, y0, x1, y1, c, thick = 1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let k = 0; k < thick; k++) put(t, x + k, y, mul(c, jitter(r, 0.06)));
    }
  };
  // Darken the rim of whatever was drawn, the way item sprites read at a glance.
  const rim = (t, f = 0.62) => {
    const opaque = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && t[(y * 16 + x) * 4 + 3] > 0;
    const edge = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (opaque(x, y) && (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1))) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) {
      const i = (y * 16 + x) * 4;
      t[i] *= f; t[i + 1] *= f; t[i + 2] *= f;
    }
  };
  const pile = (t, r, c) => {
    clear(t);
    for (let y = 7; y < 14; y++) {
      const half = (y - 6) * 0.9;
      for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x++) if (r() < 0.8) put(t, x, y, mul(c, 0.7 + r() * 0.5));
    }
  };
  const ingot = (t, r, c) => {
    clear(t);
    art(t, r, ['', '', '', '', '',
      '.....llllllll...',
      '....l########o..',
      '...l########oo..',
      '..l########ooo..',
      '..#########oo...',
      '..########oo....',
      '..ooooooooo.....',
    ], { l: mul(c, 1.2), '#': c, o: mul(c, 0.6) });
  };
  const meat = (t, r, c, fat) => {
    clear(t);
    disk(t, r, 8, 8.5, 6, 4.6, c);
    disk(t, r, 10.5, 6.5, 2.5, 1.8, fat, 0.04);
    rim(t);
  };
  const fish = (t, r, body, fin) => {
    clear(t);
    disk(t, r, 7.5, 8, 5.2, 3, body, 0.06);
    for (let k = 0; k < 4; k++) { put(t, 12 + k, 8 - k, fin); put(t, 12 + k, 8 + k, fin); }
    put(t, 4, 7, [20, 20, 20]);
    rim(t, 0.6);
  };
  const drumstick = (t, r, c) => {
    clear(t);
    disk(t, r, 9, 7, 4.6, 4.6, c);
    line(t, r, 3, 13, 6, 10, [236, 230, 214], 2);
    put(t, 2, 13, [236, 230, 214]); put(t, 3, 14, [236, 230, 214]);
    rim(t);
  };
  const tool = (kind, mat) => (t, r) => {
    clear(t);
    const c = MATERIALS[mat];
    art(t, r, TOOLS[kind], { '#': c, l: mul(c, 1.22), o: mul(c, 0.42), '/': [146, 108, 52], s: [92, 66, 30] });
  };
  const armour = (kind, mat) => (t, r) => {
    clear(t);
    const c = MATERIALS[mat];
    art(t, r, ARMOR[kind], { '#': c, l: mul(c, 1.22), o: mul(c, 0.45) });
  };
  const bucket = (fill) => (t, r) => {
    clear(t);
    art(t, r, ['', '', '',
      '...oooooooooo...',
      '..o##########o..',
      '..oFFFFFFFFFFo..',
      '..o#l#######oo..',
      '...o#l#####oo...',
      '...o#l#####oo...',
      '....o#l###oo....',
      '....o######o....',
      '.....oooooo.....',
    ], { '#': [180, 180, 186], l: [230, 230, 236], o: [70, 70, 76], F: fill ?? [60, 60, 66] });
  };

  const items = {
    item_stick(t, r) { clear(t); line(t, r, 3, 13, 12, 4, [146, 108, 52], 1); line(t, r, 4, 13, 13, 4, [100, 72, 34], 1); },
    item_coal(t, r) { clear(t); disk(t, r, 8, 8.5, 5.5, 4.8, [44, 44, 46], 0.2); rim(t, 0.5); },
    item_charcoal(t, r) { clear(t); disk(t, r, 8, 8.5, 5.5, 4.8, [62, 50, 40], 0.2); rim(t, 0.5); },
    item_iron_ingot(t, r) { ingot(t, r, [216, 216, 216]); },
    item_gold_ingot(t, r) { ingot(t, r, [246, 208, 62]); },
    item_brick(t, r) { ingot(t, r, [176, 86, 60]); },
    item_diamond(t, r) {
      clear(t);
      art(t, r, ['', '',
        '.....oooooo.....',
        '....olllll#o....',
        '...ol#lll###o...',
        '..ol###l#####o..',
        '..o##########o..',
        '...o########o...',
        '....o######o....',
        '.....o####o.....',
        '......o##o......',
        '.......oo.......',
      ], { l: [200, 255, 250], '#': [92, 222, 214], o: [30, 100, 100] });
    },
    item_flint(t, r) {
      clear(t);
      art(t, r, ['', '', '',
        '.......oo.......',
        '......o##o......',
        '.....o#l##o.....',
        '....o#l####o....',
        '...o#l######o...',
        '...o########o...',
        '....o######o....',
        '.....oooooo.....',
      ], { '#': [70, 70, 74], l: [120, 120, 126], o: [30, 30, 34] });
    },
    item_string(t, r) {
      clear(t);
      for (let i = 0; i < 12; i++) put(t, 2 + i, Math.round(8 + Math.sin(i * 0.9) * 3), mul([236, 236, 236], jitter(r, 0.05)));
    },
    item_feather(t, r) {
      clear(t);
      line(t, r, 3, 13, 12, 3, [160, 160, 160], 1);
      for (let i = 0; i < 8; i++) { put(t, 5 + i, 10 - i, [240, 240, 240]); put(t, 6 + i, 11 - i, [222, 222, 222]); put(t, 4 + i, 9 - i, [250, 250, 250]); }
      rim(t, 0.8);
    },
    item_gunpowder(t, r) { pile(t, r, [92, 92, 92]); },
    item_bone(t, r) {
      clear(t);
      line(t, r, 4, 12, 11, 5, [232, 228, 210], 2);
      for (const [x, y] of [[2, 12], [3, 13], [4, 14], [12, 3], [13, 4], [11, 2]]) put(t, x, y, [240, 236, 220]);
      rim(t, 0.75);
    },
    item_bone_meal(t, r) { pile(t, r, [236, 234, 226]); },
    item_leather(t, r) { clear(t); disk(t, r, 8, 8, 6, 5.5, [150, 90, 48], 0.1); rim(t); },
    item_rotten_flesh(t, r) { clear(t); disk(t, r, 8, 8.5, 6, 4.5, [120, 110, 56], 0.25); rim(t); },
    item_emerald(t, r) {
      clear(t);
      art(t, r, ['', '',
        '.......oo.......',
        '......olgo......',
        '.....olg##o.....',
        '....olg####o....',
        '....og#####o....',
        '....o######o....',
        '....o######o....',
        '.....o####o.....',
        '......o##o......',
        '.......oo.......',
      ], { l: [210, 255, 220], g: [120, 240, 160], '#': [40, 190, 90], o: [16, 90, 44] });
    },
    item_gold_nugget(t, r) { clear(t); disk(t, r, 8, 9, 3.2, 2.6, [250, 214, 70], 0.1); disk(t, r, 6.5, 6.5, 1.6, 1.4, [255, 240, 150], 0.05); rim(t, 0.6); },
    item_ghast_tear(t, r) {
      clear(t);
      art(t, r, ['', '', '',
        '.......o........',
        '......olo.......',
        '.....ol##o......',
        '....ol####o.....',
        '....o#####o.....',
        '....o#####o.....',
        '.....o###o......',
        '......ooo.......',
      ], { l: [255, 255, 255], '#': [206, 236, 236], o: [120, 150, 156] });
    },
    item_slimeball(t, r) { clear(t); disk(t, r, 8, 8.5, 4.6, 4.2, [120, 200, 96], 0.08); disk(t, r, 6.5, 7, 1.4, 1.2, [190, 240, 170], 0.03); rim(t, 0.55); },
    item_ink_sac(t, r) {
      clear(t);
      disk(t, r, 8, 9, 4.5, 4.8, [40, 40, 52], 0.08);
      disk(t, r, 8, 4.5, 1.4, 1.6, [60, 60, 74], 0.08);
      rim(t, 0.5);
    },
    item_egg(t, r) { clear(t); disk(t, r, 8, 8.8, 4.2, 5.4, [236, 222, 196], 0.04); disk(t, r, 6.6, 6.6, 1.2, 1.6, [252, 246, 232], 0.02); rim(t, 0.62); },
    item_ender_pearl(t, r) { clear(t); disk(t, r, 8, 8, 5.5, 5.5, [26, 92, 84], 0.1); disk(t, r, 7, 7, 2.5, 2.5, [80, 170, 150], 0.05); rim(t, 0.6); },
    item_eye_of_ender(t, r) {
      clear(t);
      disk(t, r, 8, 8, 5.5, 5.5, [70, 160, 90], 0.08);
      disk(t, r, 8, 8, 1.2, 3.5, [16, 22, 18], 0.05);
      rim(t, 0.55);
    },
    item_blaze_rod(t, r) { clear(t); line(t, r, 3, 13, 12, 4, [252, 196, 40], 2); rim(t, 0.7); },
    item_blaze_powder(t, r) { pile(t, r, [250, 150, 30]); },
    item_glowstone_dust(t, r) { pile(t, r, [250, 214, 110]); },
    item_quartz(t, r) {
      clear(t);
      art(t, r, ['', '', '',
        '......oooo......',
        '.....ollll#o....',
        '....oll####o....',
        '...ol######o....',
        '...o######o.....',
        '...o#####o......',
        '....ooooo.......',
      ], { l: [255, 255, 255], '#': [226, 218, 210], o: [140, 130, 124] });
    },
    item_lapis_lazuli(t, r) {
      clear(t);
      art(t, r, ['', '', '',
        '.....oooooo.....',
        '....o#l####o....',
        '...o#l######o...',
        '...o#########o..',
        '...o##g######o..',
        '....o#######o...',
        '.....o#####o....',
        '......ooooo.....',
      ], { l: [110, 150, 240], '#': [36, 78, 200], g: [214, 180, 60], o: [16, 34, 100] });
    },
    item_clay_ball(t, r) { clear(t); disk(t, r, 8, 8.5, 4.5, 4.5, [162, 168, 184], 0.06); rim(t); },
    item_paper(t, r) {
      clear(t);
      for (let y = 3; y < 13; y++) for (let x = 3 + (y > 7 ? 1 : 0); x < 13 + (y > 7 ? 1 : 0); x++) put(t, x, y, mul([240, 240, 232], jitter(r, 0.03)));
      rim(t, 0.8);
    },
    item_book(t, r) {
      clear(t);
      art(t, r, ['', '',
        '...oooooooooo...',
        '...o########wo..',
        '...o#l######wo..',
        '...o#l######wo..',
        '...o########wo..',
        '...o########wo..',
        '...o########wo..',
        '...o########wo..',
        '...o########wo..',
        '...oooooooooo...',
      ], { '#': [128, 70, 40], l: [168, 100, 60], w: [236, 230, 214], o: [60, 30, 18] });
    },
    item_wheat(t) {
      clear(t);
      for (const [x, lean] of [[5, -1], [8, 0], [11, 1]]) {
        for (let k = 0; k < 12; k++) put(t, x + Math.round((lean * k) / 8), 14 - k, k > 6 ? [222, 184, 74] : [184, 150, 60]);
      }
      rim(t, 0.75);
    },
    item_wheat_seeds(t, r) {
      clear(t);
      for (let i = 0; i < 7; i++) {
        const x = 4 + ((r() * 8) | 0);
        const y = 5 + ((r() * 7) | 0);
        put(t, x, y, [80, 160, 60]); put(t, x + 1, y, [60, 120, 44]);
      }
    },
    item_bread(t, r) {
      clear(t);
      disk(t, r, 8, 9, 7, 3.6, [196, 134, 58]);
      for (const x of [5, 8, 11]) { put(t, x, 7, [150, 96, 40]); put(t, x + 1, 8, [150, 96, 40]); }
      rim(t);
    },
    item_apple(t, r) {
      clear(t);
      disk(t, r, 8, 9.5, 5.2, 5, [214, 34, 34]);
      disk(t, r, 6.5, 8, 1.4, 1.4, [255, 140, 140], 0.02);
      put(t, 8, 3, [96, 64, 30]); put(t, 8, 4, [96, 64, 30]); put(t, 9, 3, [70, 150, 50]); put(t, 10, 2, [70, 150, 50]);
      rim(t);
    },
    item_golden_apple(t, r) {
      clear(t);
      disk(t, r, 8, 9.5, 5.2, 5, [246, 208, 62]);
      disk(t, r, 6.5, 8, 1.4, 1.4, [255, 250, 200], 0.02);
      put(t, 8, 3, [96, 64, 30]); put(t, 8, 4, [96, 64, 30]); put(t, 9, 3, [70, 150, 50]);
      rim(t);
    },
    item_porkchop(t, r) { meat(t, r, [236, 140, 140], [250, 226, 220]); },
    item_cooked_porkchop(t, r) { meat(t, r, [176, 112, 66], [230, 200, 160]); },
    item_beef(t, r) { meat(t, r, [196, 52, 52], [236, 200, 200]); },
    item_steak(t, r) { meat(t, r, [124, 72, 40], [180, 130, 90]); },
    item_mutton(t, r) { meat(t, r, [204, 74, 70], [240, 220, 210]); },
    item_cooked_mutton(t, r) { meat(t, r, [146, 86, 52], [210, 170, 130]); },
    item_chicken(t, r) { drumstick(t, r, [240, 186, 170]); },
    item_cooked_chicken(t, r) { drumstick(t, r, [200, 132, 64]); },
    item_bucket: bucket(null),
    item_water_bucket: bucket([52, 96, 210]),
    item_lava_bucket: bucket([250, 120, 30]),
    item_milk_bucket: bucket([244, 244, 240]),
    item_flint_and_steel(t, r) {
      clear(t);
      art(t, r, ['', '',
        '.....oooo.......',
        '....o####o......',
        '...o#o..o#o.....',
        '...o#o..o#o.....',
        '....o#oo#o......',
        '.....o##o.......',
        '......oo..ffo...',
        '.........fFFfo..',
        '........fFFFFo..',
        '.........fFFo...',
        '..........oo....',
      ], { '#': [200, 200, 206], o: [70, 70, 76], f: [60, 60, 64], F: [100, 100, 106] });
    },
    item_shears(t, r) {
      clear(t);
      line(t, r, 4, 12, 12, 4, [210, 210, 216], 1);
      line(t, r, 4, 4, 12, 12, [180, 180, 186], 1);
      for (const [x, y] of [[3, 13], [2, 12], [3, 3], [2, 2]]) put(t, x, y, [150, 40, 40]);
      rim(t, 0.8);
    },
    item_fishing_rod(t, r) {
      clear(t);
      line(t, r, 2, 14, 12, 2, [124, 88, 44], 1);
      for (let y = 3; y < 13; y++) put(t, 13, y, [220, 220, 220]);
      put(t, 13, 13, [140, 140, 150]); put(t, 12, 13, [140, 140, 150]);
    },
    item_boat(t, r) {
      clear(t);
      art(t, r, ['', '', '', '', '', '',
        'o..............o',
        'o#............#o',
        'o##..........##o',
        '.o############o.',
        '..o##########o..',
        '...oooooooooo...',
      ], { '#': [160, 120, 70], o: [96, 70, 40] });
    },
    item_cod(t, r) { fish(t, r, [196, 170, 130], [150, 120, 90]); },
    item_cooked_cod(t, r) { fish(t, r, [214, 186, 150], [170, 130, 90]); },
    item_salmon(t, r) { fish(t, r, [176, 60, 50], [110, 120, 130]); },
    item_cooked_salmon(t, r) { fish(t, r, [214, 120, 80], [150, 90, 60]); },
    item_bow(t, r) {
      clear(t);
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI;
        const x = Math.round(2 + i * 0.9 + Math.sin(a) * 3);
        const y = Math.round(2 + i * 0.9 - Math.sin(a) * 3);
        put(t, x, y, [140, 96, 44]); put(t, x + 1, y, [100, 68, 30]);
      }
      line(t, r, 3, 3, 13, 13, [220, 220, 220], 1);
    },
    item_arrow(t, r) {
      clear(t);
      line(t, r, 3, 12, 11, 4, [146, 108, 52], 1);
      for (const [x, y] of [[12, 3], [13, 2], [12, 2], [11, 3]]) put(t, x, y, [180, 180, 186]);
      for (const [x, y] of [[2, 12], [3, 13], [2, 13], [1, 12], [3, 14], [2, 11]]) put(t, x, y, [236, 236, 236]);
    },
    item_red_dye(t, r) { pile(t, r, [200, 40, 40]); },
    item_orange_dye(t, r) { pile(t, r, [234, 130, 40]); },
    item_magenta_dye(t, r) { pile(t, r, [196, 74, 196]); },
    item_light_blue_dye(t, r) { pile(t, r, [110, 160, 226]); },
    item_lime_dye(t, r) { pile(t, r, [120, 200, 50]); },
    item_pink_dye(t, r) { pile(t, r, [238, 156, 182]); },
    item_gray_dye(t, r) { pile(t, r, [74, 74, 80]); },
    item_light_gray_dye(t, r) { pile(t, r, [160, 160, 166]); },
    item_cyan_dye(t, r) { pile(t, r, [44, 140, 160]); },
    item_purple_dye(t, r) { pile(t, r, [130, 60, 186]); },
    item_green_dye(t, r) { pile(t, r, [80, 110, 34]); },
    item_sugar(t, r) { pile(t, r, [246, 246, 250]); },
    item_bowl(t, r) {
      clear(t);
      art(t, r, ['', '', '', '', '', '',
        '.oooooooooooooo.',
        'o##############o',
        '.o############o.',
        '..o##########o..',
        '...oo######oo...',
        '.....oooooo.....',
      ], { '#': [150, 104, 56], o: [90, 60, 30] });
    },
    item_mushroom_stew(t, r) {
      clear(t);
      art(t, r, ['', '', '', '', '',
        '...ssbsssbsss...',
        '.oossssbssssoo..',
        'o##############o',
        '.o############o.',
        '..o##########o..',
        '...oo######oo...',
        '.....oooooo.....',
      ], { '#': [150, 104, 56], o: [90, 60, 30], s: [196, 150, 100], b: [120, 80, 60] });
    },
    item_pumpkin_seeds(t, r) {
      clear(t);
      for (const [x, y] of [[4, 6], [9, 4], [7, 10], [11, 9], [5, 12]]) { put(t, x, y, [236, 226, 180]); put(t, x + 1, y, [220, 206, 160]); put(t, x, y + 1, [200, 190, 140]); }
    },
    item_melon_seeds(t, r) {
      clear(t);
      for (const [x, y] of [[4, 6], [9, 4], [7, 10], [11, 9], [5, 12]]) { put(t, x, y, [40, 30, 24]); put(t, x + 1, y, [60, 46, 36]); put(t, x, y + 1, [30, 22, 18]); }
    },
    item_melon_slice(t, r) {
      clear(t);
      art(t, r, ['', '', '', '', '',
        '..g.............',
        '..gr............',
        '..grrr..........',
        '..grrkrr........',
        '..grrrrrrr......',
        '..grkrrrkrrr....',
        '..grrrrrrrrrr...',
        '..gggggggggggg..',
      ], { g: [90, 150, 40], r: [220, 60, 50], k: [30, 20, 20] });
    },
    item_pumpkin_pie(t, r) {
      clear(t);
      disk(t, r, 8, 9, 6.2, 4.2, [200, 140, 70], 0.06);
      disk(t, r, 8, 8.4, 4.8, 3, [222, 130, 40], 0.06);
      rim(t, 0.55);
    },
    item_yellow_dye(t, r) { pile(t, r, [240, 210, 50]); },
    item_sugar_cane(t) {
      clear(t);
      for (const x of [5, 9]) for (let y = 2; y < 15; y++) put(t, x, y, (y + x) % 4 === 0 ? [150, 196, 110] : [110, 170, 74]);
    },
    item_oak_door(t, r) {
      clear(t);
      art(t, r, ['',
        '.....oooooo.....',
        '.....o#..#o.....',
        '.....o#..#o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o###Ho.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....o####o.....',
        '.....oooooo.....',
      ], { '#': [150, 116, 66], o: [90, 64, 32], H: [60, 60, 60] });
    },
    item_bed(t, r) {
      clear(t);
      art(t, r, ['', '', '', '', '', '',
        '.wwww...........',
        '.wwwwRRRRRRRRRR.',
        '.RRRRRRRRRRRRRR.',
        '.bbbbbbbbbbbbbb.',
        '.b............b.',
      ], { w: [236, 236, 230], R: [170, 34, 34], b: [130, 92, 50] });
    },
  };

  for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond']) {
    for (const kind of Object.keys(TOOLS)) items[`item_${mat}_${kind}`] = tool(kind, mat);
  }
  for (const mat of ['leather', 'iron', 'golden', 'diamond']) {
    for (const kind of Object.keys(ARMOR)) items[`item_${mat}_${kind}`] = armour(kind, mat);
  }
  return items;
}
