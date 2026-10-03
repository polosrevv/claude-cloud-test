// Minimal column-major 4x4 matrix helpers (WebGL layout).

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaling(s) {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

export function rotationX(a) {
  const m = identity();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function rotationY(a) {
  const m = identity();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function rotationZ(a) {
  const m = identity();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

// Camera basis for a yaw/pitch look direction. yaw 0 faces -z.
export function cameraBasis(yaw, pitch) {
  const cp = Math.cos(pitch);
  const forward = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

// Rotation-only view matrix; the scene is drawn relative to the camera so
// coordinates stay small and precise far from the origin.
export function viewRotation({ forward, right, up }) {
  const m = new Float32Array(16);
  m[0] = right[0]; m[4] = right[1]; m[8] = right[2];
  m[1] = up[0]; m[5] = up[1]; m[9] = up[2];
  m[2] = -forward[0]; m[6] = -forward[1]; m[10] = -forward[2];
  m[15] = 1;
  return m;
}

// Six planes (a, b, c, d) from a view-projection matrix; inside when ax+by+cz+d >= 0.
export function frustumPlanes(m) {
  const planes = [];
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0);
  const r1 = row(1);
  const r2 = row(2);
  const r3 = row(3);
  for (const [r, sign] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]]) {
    planes.push([r3[0] + sign * r[0], r3[1] + sign * r[1], r3[2] + sign * r[2], r3[3] + sign * r[3]]);
  }
  return planes;
}

export function boxInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (const [a, b, c, d] of planes) {
    const x = a > 0 ? maxX : minX;
    const y = b > 0 ? maxY : minY;
    const z = c > 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}
