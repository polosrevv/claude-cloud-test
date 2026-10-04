// WebGL2 renderer: sky, chunk meshes, water, block outline, break particles
// and the held block. Everything is drawn relative to the camera.
import { CHUNK } from './terrain.js';
import {
  perspective, multiply, translation, rotationX, rotationY, rotationZ, scaling,
  cameraBasis, viewRotation, frustumPlanes, boxInFrustum,
} from './math.js';

const CHUNK_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aTex;
layout(location = 2) in vec4 aLight;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform float uTime;
uniform int uWater;
out vec3 vUV;
out vec2 vLight;
out float vShade;
out float vDist;
const float AO[4] = float[4](0.42, 0.62, 0.8, 1.0);
void main() {
  vec3 p = aPos / 16.0 + uOffset;
  vec2 uv = aTex.xy;
  if (uWater == 1) uv += vec2(uTime * 0.021, uTime * 0.034);
  vUV = vec3(uv, aTex.z);
  vLight = aLight.xy / 240.0;
  vShade = AO[int(aLight.z)] * aLight.w / 255.0;
  vDist = length(p);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const CHUNK_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uDaylight;
uniform vec3 uSkyTint;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform int uWater;
uniform float uBrightness;
in vec3 vUV;
in vec2 vLight;
in float vShade;
in float vDist;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (uWater == 0 && tex.a < 0.5) discard;
  float sky = pow(0.85, (1.0 - vLight.x) * 15.0) * uDaylight;
  float blk = vLight.y > 0.0 ? pow(0.85, (1.0 - vLight.y) * 15.0) : 0.0;
  vec3 light = max(uSkyTint * sky, vec3(1.0, 0.86, 0.66) * blk * 1.08);
  light = max(light, vec3(0.045));
  vec3 color = tex.rgb * light * vShade * uBrightness;
  float fog = smoothstep(uFog.x, uFog.y, vDist);
  float alpha = uWater == 1 ? mix(tex.a, 1.0, fog) : 1.0;
  outColor = vec4(mix(color, uFogColor, fog), alpha);
}`;

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uTan;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunset;
uniform float uSunsetAmt;
uniform float uNight;
uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uCloudColor;
uniform float uCloudY;
out vec4 outColor;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Square sun and moon, like everything else in this world.
float disc(vec3 dir, vec3 centre, float size) {
  float d = dot(dir, centre);
  if (d <= 0.0) return 0.0;
  vec3 r = normalize(cross(centre, vec3(0.0, 0.0, 1.0)));
  vec3 u = cross(r, centre);
  vec2 q = vec2(dot(dir, r), dot(dir, u)) / d;
  return max(abs(q.x), abs(q.y)) < size ? 1.0 : 0.0;
}

void main() {
  vec3 dir = normalize(uForward + vNdc.x * uTan.x * uRight + vNdc.y * uTan.y * uUp);
  float h = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  // Below the horizon the sky matches the fog colour so distant terrain fades in seamlessly.
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.7, smoothstep(0.25, 0.9, -h));
  float toSun = max(dot(dir, uSunDir), 0.0);
  col += uSunset * uSunsetAmt * pow(toSun, 5.0) * (1.0 - clamp(abs(h) * 2.5, 0.0, 1.0)) * 0.6;

  if (uNight > 0.01 && h > 0.0) {
    vec3 a = abs(dir);
    vec3 cube = dir / max(a.x, max(a.y, a.z));
    float s = hash3(floor(cube * 190.0));
    if (s > 0.998) col += vec3(0.85, 0.88, 1.0) * uNight * smoothstep(0.0, 0.2, h) * (0.4 + 0.6 * (s - 0.998) / 0.002);
  }

  float sun = disc(dir, uSunDir, 0.075);
  col = mix(col, vec3(1.0, 0.96, 0.82), sun);
  col += vec3(1.0, 0.85, 0.6) * pow(toSun, 60.0) * 0.35 * (1.0 - uNight);
  vec3 moonDir = -uSunDir;
  if (disc(dir, moonDir, 0.05) > 0.0) {
    float d = dot(dir, moonDir);
    vec3 r = normalize(cross(moonDir, vec3(0.0, 0.0, 1.0)));
    vec3 u = cross(r, moonDir);
    vec2 q = vec2(dot(dir, r), dot(dir, u)) / d;
    float crater = hash2(floor(q * 60.0)) > 0.75 ? 0.82 : 1.0;
    col = mix(col, vec3(0.86, 0.88, 0.94) * crater, 0.95);
  }

  // A flat layer of blocky clouds drifting east.
  if (h > 0.0 && uCamPos.y < uCloudY) {
    float t = (uCloudY - uCamPos.y) / h;
    vec2 p = uCamPos.xz + dir.xz * t + vec2(uTime * 1.6, 0.0);
    vec2 cell = floor(p / 12.0);
    float n = valueNoise(cell * 0.11) * 0.7 + valueNoise(cell * 0.37) * 0.3;
    if (n > 0.6) {
      float fade = 1.0 - smoothstep(180.0, 900.0, t);
      col = mix(col, uCloudColor, 0.88 * fade);
    }
  }
  outColor = vec4(col, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform float uScale;
void main() {
  gl_Position = uViewProj * vec4(aPos * uScale + uOffset, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const PARTICLE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUV;
layout(location = 2) in float aBright;
uniform mat4 uViewProj;
out vec3 vUV;
out float vBright;
out float vDist;
void main() {
  vUV = aUV;
  vBright = aBright;
  vDist = length(aPos);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec3 uFogColor;
uniform vec2 uFog;
in vec3 vUV;
in float vBright;
in float vDist;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (tex.a < 0.5) discard;
  outColor = vec4(mix(tex.rgb * vBright, uFogColor, smoothstep(uFog.x, uFog.y, vDist)), 1.0);
}`;

function compile(gl, vsSource, fsSource) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u: uniforms };
}

// The 12 edges of a unit cube, for the targeted-block outline.
const CUBE_EDGES = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
  0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0,
  0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1,
]);

const MAX_PARTICLES = 512;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser does not support WebGL2, which the game needs to draw the world.');
    this.gl = gl;
    this.canvas = canvas;
    this.chunkProgram = compile(gl, CHUNK_VS, CHUNK_FS);
    this.skyProgram = compile(gl, SKY_VS, SKY_FS);
    this.lineProgram = compile(gl, LINE_VS, LINE_FS);
    this.particleProgram = compile(gl, PARTICLE_VS, PARTICLE_FS);
    this.emptyVao = gl.createVertexArray();

    this.quadIndex = gl.createBuffer();
    this.quadCapacity = 0;
    this.ensureQuadIndices(16384);

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    const lineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_EDGES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.particleData = new Float32Array(MAX_PARTICLES * 4 * 7);
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);

    this.itemMesh = null;
    this.stats = { chunks: 0, quads: 0 };
  }

  ensureQuadIndices(quads) {
    if (quads <= this.quadCapacity) return;
    const gl = this.gl;
    const cap = Math.max(quads, this.quadCapacity * 2);
    const idx = new Uint32Array(cap * 6);
    for (let q = 0, v = 0, i = 0; q < cap; q++, v += 4) {
      idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2;
      idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3;
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.quadCapacity = cap;
  }

  uploadTextures(textures) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, textures.tileSize, textures.tileSize, textures.count, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, textures.data);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 3);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.texture = tex;
  }

  createMesh(buffer, quads) {
    if (!quads) return null;
    const gl = this.gl;
    this.ensureQuadIndices(quads);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 16, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);
    return { vao, vbo, count: quads * 6, quads };
  }

  deleteMesh(mesh) {
    if (!mesh) return;
    this.gl.deleteVertexArray(mesh.vao);
    this.gl.deleteBuffer(mesh.vbo);
  }

  uploadChunkMesh(chunk, mesh) {
    this.deleteChunkMesh(chunk);
    chunk.gpu = {
      solid: this.createMesh(mesh.solid, mesh.solidQuads),
      water: this.createMesh(mesh.water, mesh.waterQuads),
      minY: mesh.minY,
      maxY: mesh.maxY,
    };
  }

  deleteChunkMesh(chunk) {
    if (!chunk.gpu) return;
    this.deleteMesh(chunk.gpu.solid);
    this.deleteMesh(chunk.gpu.water);
    chunk.gpu = null;
  }

  setItemMesh(item) {
    this.deleteMesh(this.itemMesh);
    this.itemMesh = item ? this.createMesh(item.data, item.quads) : null;
    this.itemIsWater = !!item?.water;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.resolution ?? 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // frame: { cam, yaw, pitch, fov, sky, time, chunks, renderDistance, underwater,
  //          target, particles, hand: { swing, bob, light } | null }
  render(frame) {
    const gl = this.gl;
    this.resize();
    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / height;
    const { cam, sky } = frame;
    const far = frame.renderDistance * CHUNK + 48;
    const basis = cameraBasis(frame.yaw, frame.pitch);
    const proj = perspective(frame.fov, aspect, 0.08, far);
    const viewProj = multiply(proj, viewRotation(basis));
    const fogColor = frame.underwater ? [0.04 * sky.daylight + 0.02, 0.16 * sky.daylight + 0.03, 0.34 * sky.daylight + 0.05] : sky.horizon;
    const reach = frame.renderDistance * CHUNK;
    const fog = frame.underwater ? [0, 22] : [reach * 0.55, reach - 6];

    gl.viewport(0, 0, width, height);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky
    if (!frame.underwater) {
      const p = this.skyProgram;
      gl.useProgram(p.program);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      const tanY = Math.tan(frame.fov / 2);
      gl.uniform3fv(p.u.uForward, basis.forward);
      gl.uniform3fv(p.u.uRight, basis.right);
      gl.uniform3fv(p.u.uUp, basis.up);
      gl.uniform2f(p.u.uTan, tanY * aspect, tanY);
      gl.uniform3fv(p.u.uSunDir, sky.sunDir);
      gl.uniform3fv(p.u.uZenith, sky.zenith);
      gl.uniform3fv(p.u.uHorizon, sky.horizon);
      gl.uniform3fv(p.u.uSunset, sky.sunsetColor);
      gl.uniform1f(p.u.uSunsetAmt, sky.sunset);
      gl.uniform1f(p.u.uNight, sky.night);
      gl.uniform3fv(p.u.uCamPos, cam);
      gl.uniform1f(p.u.uTime, frame.time);
      gl.uniform3fv(p.u.uCloudColor, sky.cloudColor);
      gl.uniform1f(p.u.uCloudY, 168);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    // Terrain
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const cp = this.chunkProgram;
    gl.useProgram(cp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniform1i(cp.u.uTex, 0);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, viewProj);
    gl.uniform1f(cp.u.uDaylight, sky.daylight);
    gl.uniform3fv(cp.u.uSkyTint, sky.skyTint);
    gl.uniform3fv(cp.u.uFogColor, fogColor);
    gl.uniform2f(cp.u.uFog, fog[0], fog[1]);
    gl.uniform1f(cp.u.uTime, frame.time);
    gl.uniform1f(cp.u.uBrightness, 1);
    gl.uniform1i(cp.u.uWater, 0);

    const planes = frustumPlanes(viewProj);
    const visible = [];
    for (const c of frame.chunks) {
      if (!c.visible || !c.gpu) continue;
      const ox = c.cx * CHUNK - cam[0];
      const oz = c.cz * CHUNK - cam[2];
      if (!boxInFrustum(planes, ox, c.gpu.minY - cam[1], oz, ox + CHUNK, c.gpu.maxY - cam[1], oz + CHUNK)) continue;
      visible.push({ c, ox, oz, d: (ox + 8) * (ox + 8) + (oz + 8) * (oz + 8) });
    }
    visible.sort((a, b) => a.d - b.d);
    let quads = 0;
    for (const v of visible) {
      const mesh = v.c.gpu.solid;
      if (!mesh) continue;
      gl.uniform3f(cp.u.uOffset, v.ox, -cam[1], v.oz);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      quads += mesh.quads;
    }

    // Outline of the targeted block
    if (frame.target) {
      const lp = this.lineProgram;
      gl.useProgram(lp.program);
      gl.uniformMatrix4fv(lp.u.uViewProj, false, viewProj);
      const t = frame.target;
      gl.uniform3f(lp.u.uOffset, t.x - cam[0] - 0.002, t.y - cam[1] - 0.002, t.z - cam[2] - 0.002);
      gl.uniform1f(lp.u.uScale, 1.004);
      gl.uniform4f(lp.u.uColor, 0.02, 0.02, 0.02, 1);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, 24);
    }

    this.drawParticles(frame, viewProj, basis, fogColor, fog);

    // Water, far to near, both sides visible
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(cp.program);
    gl.uniform1i(cp.u.uWater, 1);
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      const mesh = v.c.gpu.water;
      if (!mesh) continue;
      gl.uniform3f(cp.u.uOffset, v.ox, -cam[1], v.oz);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      quads += mesh.quads;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    if (frame.hand && this.itemMesh) this.drawHand(frame, aspect);

    gl.bindVertexArray(null);
    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  }

  drawParticles(frame, viewProj, basis, fogColor, fog) {
    const list = frame.particles;
    if (!list || !list.length) return;
    const gl = this.gl;
    const data = this.particleData;
    const { right, up } = basis;
    const cam = frame.cam;
    const n = Math.min(list.length, MAX_PARTICLES);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const cx = p.pos[0] - cam[0];
      const cy = p.pos[1] - cam[1];
      const cz = p.pos[2] - cam[2];
      const s = p.size;
      const corners = [[-1, -1, p.u0, p.v0 + 0.25], [1, -1, p.u0 + 0.25, p.v0 + 0.25], [1, 1, p.u0 + 0.25, p.v0], [-1, 1, p.u0, p.v0]];
      for (const [sx, sy, u, v] of corners) {
        data[o++] = cx + (right[0] * sx + up[0] * sy) * s;
        data[o++] = cy + (right[1] * sx + up[1] * sy) * s;
        data[o++] = cz + (right[2] * sx + up[2] * sy) * s;
        data[o++] = u;
        data[o++] = v;
        data[o++] = p.layer;
        data[o++] = p.light;
      }
    }
    const pp = this.particleProgram;
    gl.useProgram(pp.program);
    gl.uniformMatrix4fv(pp.u.uViewProj, false, viewProj);
    gl.uniform1i(pp.u.uTex, 0);
    gl.uniform3fv(pp.u.uFogColor, fogColor);
    gl.uniform2f(pp.u.uFog, fog[0], fog[1]);
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, o);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
  }

  drawHand(frame, aspect) {
    const gl = this.gl;
    const { swing, bob, light } = frame.hand;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const s = Math.sin(Math.sqrt(swing) * Math.PI);
    const s2 = Math.sin(swing * Math.PI);
    // Keep the block in the lower right corner even on tall, narrow screens.
    const side = Math.min(0.66, Math.tan((35 * Math.PI) / 180) * aspect * 1.05 * 0.62);
    let model = translation(side - s * 0.24 + bob[0], -0.62 + Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.1 + bob[1] - s2 * 0.08, -1.05);
    model = multiply(model, rotationY(Math.PI / 4 + s * 0.6));
    model = multiply(model, rotationX(0.12 - s2 * 0.5));
    model = multiply(model, rotationZ(s2 * 0.25));
    model = multiply(model, scaling(0.3));
    const proj = perspective((70 * Math.PI) / 180, aspect, 0.05, 10);
    const cp = this.chunkProgram;
    gl.useProgram(cp.program);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, multiply(proj, model));
    gl.uniform3f(cp.u.uOffset, -0.5, -0.5, -0.5);
    gl.uniform2f(cp.u.uFog, 1000, 1001);
    gl.uniform1f(cp.u.uBrightness, light);
    gl.uniform1i(cp.u.uWater, this.itemIsWater ? 1 : 0);
    if (this.itemIsWater) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.bindVertexArray(this.itemMesh.vao);
    gl.drawElements(gl.TRIANGLES, this.itemMesh.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    gl.uniform1i(cp.u.uWater, 0);
  }
}
