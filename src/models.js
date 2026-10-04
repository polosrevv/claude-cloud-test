// Mob models made of cuboids, in pixels (1/16 block), y up, facing -z, origin
// at the feet. Each part rotates about its pivot; children inherit their
// parent's transform. UVs follow the box layout described in skins.js.
import { boxRegions, SKIN, SKIN_NAMES } from './skins.js';

const HALF_PI = Math.PI / 2;

function cube(from, size, uv, extra = {}) {
  return { from, size, uv, ...extra };
}

function humanoid({ armW = 4, legW = 4, armUV = [40, 16], legUV = [0, 16], bodyUV = [16, 16], armLen = 12, legLen = 12, hip = 12, neck = 24 }) {
  const ah = armW / 2;
  const lh = legW / 2;
  return [
    { name: 'body', pivot: [0, neck, 0], cubes: [cube([-4, -12, -2], [8, 12, 4], bodyUV)] },
    { name: 'head', pivot: [0, neck, 0], cubes: [cube([-4, 0, -4], [8, 8, 8], [0, 0])] },
    { name: 'rightArm', pivot: [4 + ah, neck - 2, 0], cubes: [cube([-ah, -(armLen - 2), -ah], [armW, armLen, armW], armUV)] },
    { name: 'leftArm', pivot: [-4 - ah, neck - 2, 0], cubes: [cube([-ah, -(armLen - 2), -ah], [armW, armLen, armW], armUV)] },
    { name: 'rightLeg', pivot: [lh, hip, 0], cubes: [cube([-lh, -legLen, -lh], [legW, legLen, legW], legUV)] },
    { name: 'leftLeg', pivot: [-lh, hip, 0], cubes: [cube([-lh, -legLen, -lh], [legW, legLen, legW], legUV)] },
  ];
}

function quadruped({ legs, legSize, legUV = [0, 16] }) {
  return legs.map(([x, y, z], i) => ({
    name: `leg${i}`,
    pivot: [x, y, z],
    cubes: [cube([-legSize[0] / 2, -legSize[1], -legSize[2] / 2], legSize, legUV)],
  }));
}

const walk = (e, k = 1.4) => Math.cos(e.limbSwing * 0.6662) * k * e.limbAmount;

function humanoidAnim({ armsForward = false } = {}) {
  return (e, t, out) => {
    const s = walk(e);
    out.head = { rot: [e.headPitch, e.headYaw, 0] };
    out.rightLeg = { rot: [s, 0, 0] };
    out.leftLeg = { rot: [-s, 0, 0] };
    const sway = Math.sin(t * 0.067) * 0.05;
    let ra = -s * 0.5;
    let la = s * 0.5;
    if (armsForward || e.aiming) {
      ra = HALF_PI + sway - (e.aiming ? 0 : 0.1);
      la = HALF_PI - sway - (e.aiming ? 0 : 0.1);
    }
    ra += e.attackAnim * 1.2;
    out.rightArm = { rot: [ra, e.aiming ? -0.1 + e.headYaw : 0, sway] };
    out.leftArm = { rot: [la, e.aiming ? 0.4 + e.headYaw : 0, -sway] };
  };
}

export const MODEL_DEFS = {
  zombie: { skin: 'zombie', parts: humanoid({}), anim: humanoidAnim({ armsForward: true }) },
  player: { skin: 'player', parts: humanoid({}), anim: humanoidAnim() },
  skeleton: { skin: 'skeleton', parts: humanoid({ armW: 2, legW: 2, legUV: [40, 16] }), anim: humanoidAnim() },
  enderman: {
    skin: 'enderman',
    parts: humanoid({ armW: 2, legW: 2, armUV: [56, 0], legUV: [56, 0], bodyUV: [32, 16], armLen: 28, legLen: 26, hip: 26, neck: 38 }),
    anim: (e, t, out) => {
      humanoidAnim()(e, t, out);
      out.rightLeg.rot[0] *= 0.4;
      out.leftLeg.rot[0] *= 0.4;
      out.rightArm.rot[0] *= 0.4;
      out.leftArm.rot[0] *= 0.4;
      if (e.angry) out.head = { rot: [e.headPitch, e.headYaw, 0], pos: [0, 4, 0] };
    },
  },
  creeper: {
    skin: 'creeper',
    parts: [
      { name: 'body', pivot: [0, 18, 0], cubes: [cube([-4, -12, -2], [8, 12, 4], [16, 16])] },
      { name: 'head', pivot: [0, 18, 0], cubes: [cube([-4, 0, -4], [8, 8, 8], [0, 0])] },
      ...quadruped({ legs: [[2, 6, -4], [-2, 6, -4], [2, 6, 4], [-2, 6, 4]], legSize: [4, 6, 4] }),
    ],
    anim: (e, t, out) => {
      const s = walk(e);
      out.head = { rot: [e.headPitch, e.headYaw, 0] };
      out.leg0 = { rot: [s, 0, 0] }; out.leg1 = { rot: [-s, 0, 0] };
      out.leg2 = { rot: [-s, 0, 0] }; out.leg3 = { rot: [s, 0, 0] };
    },
  },
  pig: {
    skin: 'pig',
    parts: [
      { name: 'body', pivot: [0, 10, 2], rot: [HALF_PI, 0, 0], cubes: [cube([-5, -8, -4], [10, 16, 8], [28, 8])] },
      { name: 'head', pivot: [0, 12, -6], cubes: [cube([-4, -4, -8], [8, 8, 8], [0, 0]), cube([-2, -3, -9], [4, 3, 1], [16, 16])] },
      ...quadruped({ legs: [[3, 6, -4], [-3, 6, -4], [3, 6, 7], [-3, 6, 7]], legSize: [4, 6, 4] }),
    ],
    anim: quadAnim,
  },
  cow: {
    skin: 'cow',
    parts: [
      { name: 'body', pivot: [0, 17, 2], rot: [HALF_PI, 0, 0], cubes: [cube([-6, -9, -5], [12, 18, 10], [18, 14])] },
      { name: 'head', pivot: [0, 20, -8], cubes: [cube([-4, -4, -6], [8, 8, 6], [0, 0]), cube([-5, 2, -4], [1, 3, 1], [22, 0]), cube([4, 2, -4], [1, 3, 1], [22, 0])] },
      ...quadruped({ legs: [[4, 12, -5], [-4, 12, -5], [4, 12, 9], [-4, 12, 9]], legSize: [4, 12, 4] }),
    ],
    anim: quadAnim,
  },
  sheep: {
    skin: 'sheep',
    parts: [
      { name: 'body', pivot: [0, 15, 2], rot: [HALF_PI, 0, 0], cubes: [cube([-4, -8, -3], [8, 16, 6], [28, 8])] },
      { name: 'wool', pivot: [0, 15, 2], rot: [HALF_PI, 0, 0], cubes: [cube([-4, -8, -3], [8, 16, 6], [0, 32], { inflate: 1.75 })] },
      { name: 'head', pivot: [0, 18, -6], cubes: [cube([-3, -3, -7], [6, 6, 8], [0, 0])] },
      { name: 'headWool', parent: 'head', pivot: [0, 0, 0], cubes: [cube([-3, -3, -6], [6, 6, 6], [40, 0], { inflate: 0.6 })] },
      ...quadruped({ legs: [[3, 12, -4], [-3, 12, -4], [3, 12, 8], [-3, 12, 8]], legSize: [4, 12, 4] }),
    ],
    anim: (e, t, out) => {
      quadAnim(e, t, out);
      if (e.sheared) { out.wool = { hidden: true }; out.headWool = { hidden: true }; }
    },
  },
  chicken: {
    skin: 'chicken',
    parts: [
      { name: 'body', pivot: [0, 0, 0], cubes: [cube([-3, 4, -4], [6, 6, 8], [0, 9])] },
      { name: 'head', pivot: [0, 9, -4], cubes: [cube([-2, 0, -3], [4, 6, 3], [0, 0]), cube([-2, 2, -5], [4, 2, 2], [14, 0]), cube([-1, 0, -5], [2, 2, 2], [14, 4])] },
      { name: 'rightWing', pivot: [3, 9, 0], cubes: [cube([0, -4, -3], [1, 4, 6], [24, 13])] },
      { name: 'leftWing', pivot: [-3, 9, 0], cubes: [cube([-1, -4, -3], [1, 4, 6], [24, 13])] },
      { name: 'leg0', pivot: [1.5, 4, 1], cubes: [cube([-0.5, -4, -0.5], [1, 4, 1], [26, 0])] },
      { name: 'leg1', pivot: [-1.5, 4, 1], cubes: [cube([-0.5, -4, -0.5], [1, 4, 1], [26, 0])] },
    ],
    anim: (e, t, out) => {
      const s = walk(e);
      out.head = { rot: [e.headPitch, e.headYaw, 0] };
      out.leg0 = { rot: [s, 0, 0] };
      out.leg1 = { rot: [-s, 0, 0] };
      const flap = e.onGround ? 0 : Math.abs(Math.sin(t * 0.9)) * 1.2;
      out.rightWing = { rot: [0, 0, -flap] };
      out.leftWing = { rot: [0, 0, flap] };
    },
  },
  spider: {
    skin: 'spider',
    parts: [
      { name: 'thorax', pivot: [0, 9, 0], cubes: [cube([-3, -3, -3], [6, 6, 6], [0, 0])] },
      { name: 'abdomen', pivot: [0, 9, 3], cubes: [cube([-5, -4, 0], [10, 8, 12], [0, 12])] },
      { name: 'head', pivot: [0, 9, -3], cubes: [cube([-4, -4, -8], [8, 8, 8], [32, 4])] },
      ...[0, 1, 2, 3].flatMap((i) => [
        { name: `rleg${i}`, pivot: [3, 9, -1 + i], cubes: [cube([0, -1, -1], [16, 2, 2], [18, 0])] },
        { name: `lleg${i}`, pivot: [-3, 9, -1 + i], cubes: [cube([-16, -1, -1], [16, 2, 2], [18, 0])] },
      ]),
    ],
    anim: (e, t, out) => {
      out.head = { rot: [e.headPitch, e.headYaw, 0] };
      const fan = [0.75, 0.25, -0.25, -0.75];
      const lift = [0.75, 0.55, 0.55, 0.75];
      for (let i = 0; i < 4; i++) {
        const phase = e.limbSwing * 0.6662 * 2 + (i % 2 ? Math.PI : 0);
        const swingY = Math.cos(phase) * 0.4 * e.limbAmount;
        const swingZ = Math.abs(Math.sin(phase)) * 0.4 * e.limbAmount;
        out[`rleg${i}`] = { rot: [0, fan[i] + swingY, -lift[i] + swingZ] };
        out[`lleg${i}`] = { rot: [0, -fan[i] - swingY, lift[i] - swingZ] };
      }
    },
  },
  blaze: {
    skin: 'blaze',
    parts: [
      { name: 'head', pivot: [0, 20, 0], cubes: [cube([-4, 0, -4], [8, 8, 8], [0, 0])] },
      ...Array.from({ length: 12 }, (_, i) => ({ name: `rod${i}`, pivot: [0, 0, 0], cubes: [cube([-1, 0, -1], [2, 8, 2], [0, 16])] })),
    ],
    anim: (e, t, out) => {
      out.head = { rot: [e.headPitch, e.headYaw, 0] };
      for (let i = 0; i < 12; i++) {
        const ring = Math.floor(i / 4);
        const a = (i % 4) * HALF_PI + t * (ring === 1 ? -0.05 : 0.07) + ring * 0.4;
        const r = [9, 7, 5][ring];
        const y = [16, 10, 4][ring] + Math.cos(t * 0.1 + i) * 1.2;
        out[`rod${i}`] = { pos: [Math.cos(a) * r, y, Math.sin(a) * r] };
      }
    },
  },
  dragon: {
    skin: 'dragon',
    parts: [
      { name: 'body', pivot: [0, 0, 0], cubes: [cube([-12, -12, -32], [24, 24, 64], [0, 0], { tex: [12, 12, 16] })] },
      { name: 'neck', pivot: [0, 4, -32], cubes: [cube([-5, -5, -40], [10, 10, 40], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'head', parent: 'neck', pivot: [0, 0, -40], cubes: [cube([-8, -6, -16], [16, 16, 16], [0, 28], { tex: [8, 8, 8] }), cube([-6, -4, -32], [12, 6, 16], [32, 28], { tex: [6, 3, 8] })] },
      { name: 'jaw', parent: 'head', pivot: [0, -4, -16], cubes: [cube([-6, -4, -16], [12, 4, 16], [32, 28], { tex: [6, 3, 8] })] },
      { name: 'rightWing', pivot: [12, 8, -16], cubes: [cube([0, -2, -2], [56, 4, 4], [40, 0], { tex: [2, 2, 8] }), cube([0, 0, 0], [56, 1, 48], [0, 44], { tex: [22, 1, 18] })] },
      { name: 'rightTip', parent: 'rightWing', pivot: [56, 0, 0], cubes: [cube([0, -1, -1], [56, 2, 2], [40, 0], { tex: [2, 2, 8] }), cube([0, 0, 0], [56, 1, 48], [0, 44], { tex: [22, 1, 18] })] },
      { name: 'leftWing', pivot: [-12, 8, -16], cubes: [cube([-56, -2, -2], [56, 4, 4], [40, 0], { tex: [2, 2, 8] }), cube([-56, 0, 0], [56, 1, 48], [0, 44], { tex: [22, 1, 18] })] },
      { name: 'leftTip', parent: 'leftWing', pivot: [-56, 0, 0], cubes: [cube([-56, -1, -1], [56, 2, 2], [40, 0], { tex: [2, 2, 8] }), cube([-56, 0, 0], [56, 1, 48], [0, 44], { tex: [22, 1, 18] })] },
      { name: 'tail1', pivot: [0, 0, 32], cubes: [cube([-5, -5, 0], [10, 10, 40], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'tail2', parent: 'tail1', pivot: [0, 0, 40], cubes: [cube([-4, -4, 0], [8, 8, 40], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'tail3', parent: 'tail2', pivot: [0, 0, 40], cubes: [cube([-3, -3, 0], [6, 6, 34], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'frontRight', pivot: [10, -8, -20], cubes: [cube([-3, -20, -3], [6, 20, 6], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'frontLeft', pivot: [-10, -8, -20], cubes: [cube([-3, -20, -3], [6, 20, 6], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'backRight', pivot: [12, -8, 22], cubes: [cube([-4, -26, -4], [8, 26, 8], [40, 0], { tex: [2, 2, 8] })] },
      { name: 'backLeft', pivot: [-12, -8, 22], cubes: [cube([-4, -26, -4], [8, 26, 8], [40, 0], { tex: [2, 2, 8] })] },
    ],
    anim: (e, t, out) => {
      const flap = Math.sin(t * 0.16);
      out.rightWing = { rot: [0, 0, flap * 0.55 + 0.1] };
      out.rightTip = { rot: [0, 0, Math.sin(t * 0.16 - 0.8) * 0.6 + 0.2] };
      out.leftWing = { rot: [0, 0, -flap * 0.55 - 0.1] };
      out.leftTip = { rot: [0, 0, -Math.sin(t * 0.16 - 0.8) * 0.6 - 0.2] };
      out.neck = { rot: [0.15 + Math.sin(t * 0.05) * 0.08 - e.headPitch * 0.3, e.headYaw * 0.5, 0] };
      out.head = { rot: [-0.15 + e.headPitch * 0.4, e.headYaw * 0.5, 0] };
      out.jaw = { rot: [-(Math.sin(t * 0.08) * 0.5 + 0.5) * 0.35 - (e.roar ?? 0) * 0.5, 0, 0] };
      out.tail1 = { rot: [-0.1, Math.sin(t * 0.07) * 0.15, 0] };
      out.tail2 = { rot: [0.05, Math.sin(t * 0.07 - 0.6) * 0.2, 0] };
      out.tail3 = { rot: [0.05, Math.sin(t * 0.07 - 1.2) * 0.25, 0] };
      const legs = 0.6;
      out.frontRight = { rot: [legs, 0, 0] };
      out.frontLeft = { rot: [legs, 0, 0] };
      out.backRight = { rot: [legs + 0.2, 0, 0] };
      out.backLeft = { rot: [legs + 0.2, 0, 0] };
    },
  },
  zombie_pigman: { skin: 'zombie_pigman', parts: humanoid({}), anim: humanoidAnim({ armsForward: false }) },
  ghast: ghastModel('ghast'),
  ghast_fire: ghastModel('ghast_fire'),
  wolf: wolfModel('wolf'),
  wolf_tame: wolfModel('wolf_tame'),
  wolf_angry: wolfModel('wolf_angry'),
  slime: {
    skin: 'slime',
    parts: [
      { name: 'inner', pivot: [0, 0, 0], cubes: [cube([-3, 1, -3], [6, 6, 6], [0, 16])] },
      { name: 'eyes', pivot: [0, 0, 0], cubes: [cube([-3.3, 4, -3.5], [2, 2, 1], [32, 0]), cube([1.3, 4, -3.5], [2, 2, 1], [32, 4]), cube([0, 2, -3.5], [1, 1, 1], [32, 8])] },
      { name: 'outer', pivot: [0, 0, 0], cubes: [cube([-4, 0, -4], [8, 8, 8], [0, 0])] },
    ],
    anim: (e, t, out) => {
      // Squash on landing and stretch while airborne.
      const squish = e.squish ?? 0;
      out.outer = { scale: [1 + squish * 0.25, 1 - squish * 0.3, 1 + squish * 0.25] };
      out.inner = { scale: [1 + squish * 0.2, 1 - squish * 0.25, 1 + squish * 0.2] };
      out.eyes = { scale: [1 + squish * 0.2, 1 - squish * 0.25, 1 + squish * 0.2] };
    },
  },
  squid: {
    skin: 'squid',
    parts: [
      { name: 'body', pivot: [0, 2, 0], cubes: [cube([-6, 0, -6], [12, 16, 12], [0, 0])] },
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return { name: `tentacle${i}`, pivot: [Math.cos(a) * 5, 2.5, Math.sin(a) * 5], cubes: [cube([-1, -18, -1], [2, 18, 2], [48, 0])] };
      }),
    ],
    anim: (e, t, out) => {
      const pulse = Math.sin(t * 0.2) * 0.5 + 0.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const spread = 0.15 + pulse * 0.45;
        out[`tentacle${i}`] = { rot: [Math.sin(a) * spread, 0, -Math.cos(a) * spread] };
      }
    },
  },
  villager_farmer: villagerModel('villager_farmer'),
  villager_librarian: villagerModel('villager_librarian'),
  villager_priest: villagerModel('villager_priest'),
  villager_smith: villagerModel('villager_smith'),
  villager_butcher: villagerModel('villager_butcher'),
  iron_golem: {
    skin: 'iron_golem',
    parts: [
      { name: 'rightLeg', pivot: [4, 16, 0], cubes: [cube([-3, -16, -2.5], [6, 16, 5], [42, 23], { tex: [3, 8, 3] })] },
      { name: 'leftLeg', pivot: [-4, 16, 0], cubes: [cube([-3, -16, -2.5], [6, 16, 5], [42, 23], { tex: [3, 8, 3] })] },
      { name: 'waist', pivot: [0, 16, 0], cubes: [cube([-4.5, 0, -3], [9, 5, 6], [0, 41])] },
      { name: 'body', pivot: [0, 21, 0], cubes: [cube([-9, 0, -5.5], [18, 12, 11], [0, 0])] },
      { name: 'head', pivot: [0, 33, -2], cubes: [cube([-4, 0, -5.5], [8, 10, 8], [0, 23]), cube([-1, 1, -7.5], [2, 4, 2], [54, 23])] },
      { name: 'rightArm', pivot: [11, 32, 0], cubes: [cube([-2, -29, -3], [4, 30, 6], [32, 23], { tex: [2, 15, 3] })] },
      { name: 'leftArm', pivot: [-11, 32, 0], cubes: [cube([-2, -29, -3], [4, 30, 6], [32, 23], { tex: [2, 15, 3] })] },
    ],
    anim: (e, t, out) => {
      const s = walk(e, 1);
      out.head = { rot: [e.headPitch, e.headYaw, 0] };
      out.rightLeg = { rot: [s * 0.6, 0, 0] };
      out.leftLeg = { rot: [-s * 0.6, 0, 0] };
      // Arms swing with the stride, and both come up to throw a punch.
      const lift = e.attackAnim * 1.8;
      out.rightArm = { rot: [-s * 0.6 - lift, 0, 0] };
      out.leftArm = { rot: [s * 0.6 - lift, 0, 0] };
    },
  },
  boat: {
    skin: 'boat',
    parts: [
      { name: 'hull', pivot: [0, 0, 0], cubes: [
        cube([-10, 0, -14], [20, 3, 28], [0, 0], { tex: [10, 2, 14] }),
        cube([-10, 3, -14], [2, 6, 28], [0, 16], { tex: [1, 3, 14] }),
        cube([8, 3, -14], [2, 6, 28], [0, 16], { tex: [1, 3, 14] }),
        cube([-8, 3, -14], [16, 6, 2], [0, 34], { tex: [8, 3, 1] }),
        cube([-8, 3, 12], [16, 6, 2], [0, 34], { tex: [8, 3, 1] }),
      ] },
      { name: 'rightOar', pivot: [10, 7, 0], cubes: [cube([0, -1, -1], [14, 2, 2], [32, 34], { tex: [7, 1, 1] })] },
      { name: 'leftOar', pivot: [-10, 7, 0], cubes: [cube([-14, -1, -1], [14, 2, 2], [32, 34], { tex: [7, 1, 1] })] },
    ],
    anim: (e, t, out) => {
      // The oars dip while it's being rowed.
      const rowing = e.rider && Math.hypot(e.vel[0], e.vel[2]) > 0.5;
      const a = rowing ? Math.sin(e.age * 0.4) * 0.5 : 0.2;
      out.rightOar = { rot: [0, a, -0.35] };
      out.leftOar = { rot: [0, -a, 0.35] };
    },
  },
  crystal: {
    skin: 'crystal',
    parts: [
      { name: 'outer', pivot: [0, 0, 0], cubes: [cube([-6, -6, -6], [12, 12, 12], [0, 0], { tex: [8, 8, 8] })] },
      { name: 'core', pivot: [0, 0, 0], cubes: [cube([-4, -4, -4], [8, 8, 8], [32, 0])] },
    ],
    anim: (e, t, out) => {
      const bob = Math.sin(t * 0.1) * 4 + 12;
      out.outer = { rot: [0.6, t * 0.06, 0.6], pos: [0, bob, 0] };
      out.core = { rot: [t * 0.08, 0.4, t * 0.05], pos: [0, bob, 0] };
    },
  },
  arrow: {
    skin: 'arrow',
    parts: [{ name: 'shaft', pivot: [0, 0, 0], cubes: [cube([-0.5, -0.5, -7], [1, 1, 14], [0, 0])] }],
    anim: () => {},
  },
};

function ghastModel(skin) {
  return {
    skin,
    parts: [
      { name: 'body', pivot: [0, 0, 0], cubes: [cube([-8, 0, -8], [16, 16, 16], [0, 0])] },
      ...Array.from({ length: 9 }, (_, i) => {
        const x = ((i % 3) - 1) * 5 + (i % 2 ? 0.5 : -0.5);
        const z = (Math.floor(i / 3) - 1) * 5;
        return { name: `tentacle${i}`, pivot: [x, 0.5, z], cubes: [cube([-1, -(9 + (i * 7) % 5), -1], [2, 9 + ((i * 7) % 5), 2], [0, 32], { tex: [2, 9, 2] })] };
      }),
    ],
    anim: (e, t, out) => {
      for (let i = 0; i < 9; i++) out[`tentacle${i}`] = { rot: [Math.sin(t * 0.15 + i) * 0.25 + 0.15, 0, Math.cos(t * 0.11 + i * 2) * 0.12] };
      out.body = { rot: [0, e.headYaw, 0] };
    },
  };
}

function villagerModel(skin) {
  return {
    skin,
    parts: [
      { name: 'body', pivot: [0, 24, 0], cubes: [cube([-4, -12, -3], [8, 12, 6], [16, 20]), cube([-4, -18, -3], [8, 18, 6], [0, 38], { inflate: 0.5 })] },
      { name: 'head', pivot: [0, 24, 0], cubes: [cube([-4, 0, -4], [8, 10, 8], [0, 0]), cube([-1, 1, -6], [2, 4, 2], [32, 0])] },
      // Arms folded across the chest, as villagers stand.
      { name: 'arms', pivot: [0, 21, -1], rot: [-0.75, 0, 0], cubes: [cube([-8, -2, -2], [4, 8, 4], [44, 22]), cube([4, -2, -2], [4, 8, 4], [44, 22]), cube([-4, 2, -2], [8, 4, 4], [40, 38])] },
      { name: 'rightLeg', pivot: [2, 12, 0], cubes: [cube([-2, -12, -2], [4, 12, 4], [0, 22])] },
      { name: 'leftLeg', pivot: [-2, 12, 0], cubes: [cube([-2, -12, -2], [4, 12, 4], [0, 22])] },
    ],
    anim: (e, t, out) => {
      const s = walk(e, 1.2);
      out.head = { rot: [e.headPitch, e.headYaw, Math.sin(t * 0.05) * (e.nodding ? 0.2 : 0)] };
      out.rightLeg = { rot: [s, 0, 0] };
      out.leftLeg = { rot: [-s, 0, 0] };
    },
  };
}

function wolfModel(skin) {
  return {
    skin,
    parts: [
      { name: 'body', pivot: [0, 10, 2], rot: [HALF_PI, 0, 0], cubes: [cube([-3, -2, -3], [6, 9, 6], [18, 14])] },
      { name: 'mane', pivot: [-1 + 1, 10, -1], rot: [HALF_PI, 0, 0], cubes: [cube([-4, -3, -3], [8, 6, 7], [21, 0])] },
      { name: 'head', pivot: [0, 10.5, -7], cubes: [
        cube([-3, -3, -2], [6, 6, 4], [0, 0]),
        cube([-3, 3, 0], [2, 2, 1], [16, 14]), cube([1, 3, 0], [2, 2, 1], [16, 14]),
        cube([-1.5, -3, -5], [3, 3, 4], [0, 10]),
      ] },
      { name: 'tail', pivot: [0, 12, 8], cubes: [cube([-1, -8, -1], [2, 8, 2], [9, 18])] },
      ...quadruped({ legs: [[1.5, 8, -4], [-1.5, 8, -4], [1.5, 8, 7], [-1.5, 8, 7]], legSize: [2, 8, 2], legUV: [0, 18] }),
    ],
    anim: (e, t, out) => {
      quadAnim(e, t, out);
      out.tail = { rot: [0.6 + (e.tamed ? (20 - Math.max(0, e.health)) * -0.03 + 0.4 : 0), Math.sin(t * 0.3) * 0.2 * (e.tamed ? 1 : 0.3), 0] };
      if (e.sitting) {
        out.body = { rot: [HALF_PI - 0.6, 0, 0], pos: [0, -2, 0] };
        out.mane = { rot: [HALF_PI - 0.4, 0, 0], pos: [0, -1, 0] };
        out.leg2 = { rot: [-HALF_PI, 0, 0], pos: [0, -5, -2] };
        out.leg3 = { rot: [-HALF_PI, 0, 0], pos: [0, -5, -2] };
        out.tail = { rot: [1.4, 0, 0], pos: [0, -7, -3] };
        out.head.pos = [0, 0, 0];
      }
    },
  };
}

function quadAnim(e, t, out) {
  const s = walk(e);
  out.head = { rot: [e.headPitch + (e.eating ? 0.9 : 0), e.headYaw, 0] };
  out.leg0 = { rot: [s, 0, 0] };
  out.leg1 = { rot: [-s, 0, 0] };
  out.leg2 = { rot: [-s, 0, 0] };
  out.leg3 = { rot: [s, 0, 0] };
}

// Box face corners in the same order as the block mesher (BL, BR, TR, TL).
const BOX_FACES = [
  { region: 'right', shade: 0.6, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { region: 'left', shade: 0.6, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { region: 'top', shade: 1, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { region: 'bottom', shade: 0.5, corners: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]] },
  { region: 'back', shade: 0.8, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { region: 'front', shade: 0.8, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const CORNER_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

// Vertex data: x, y, z (pixels), u, v (0..1), shade. Six vertices per face.
export function buildModelMesh(def) {
  const verts = [];
  const ranges = [];
  for (const part of def.parts) {
    const start = verts.length / 6;
    for (const c of part.cubes) {
      const inf = c.inflate ?? 0;
      const lo = [c.from[0] - inf, c.from[1] - inf, c.from[2] - inf];
      const hi = [c.from[0] + c.size[0] + inf, c.from[1] + c.size[1] + inf, c.from[2] + c.size[2] + inf];
      const [tw, th, td] = c.tex ?? c.size.map((v) => Math.max(1, Math.round(v)));
      const regions = boxRegions(c.uv[0], c.uv[1], tw, th, td);
      for (const face of BOX_FACES) {
        const [ru, rv, rw, rh] = regions[face.region];
        const quad = face.corners.map((corner, k) => [
          corner[0] ? hi[0] : lo[0], corner[1] ? hi[1] : lo[1], corner[2] ? hi[2] : lo[2],
          (ru + CORNER_UV[k][0] * rw) / SKIN, (rv + CORNER_UV[k][1] * rh) / SKIN, face.shade,
        ]);
        for (const k of [0, 1, 2, 0, 2, 3]) verts.push(...quad[k]);
      }
    }
    ranges.push({ name: part.name, start, count: verts.length / 6 - start });
  }
  return { data: new Float32Array(verts), ranges };
}

export function skinLayer(def) {
  return SKIN_NAMES.indexOf(def.skin);
}
