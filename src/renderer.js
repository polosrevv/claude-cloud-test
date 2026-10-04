// WebGL2 renderer: sky, chunk meshes, water, mobs, dropped items, particles,
// block outline and cracks, crystal beams and the held item. Everything is
// drawn relative to the camera so coordinates stay small and precise.
import { CHUNK } from './constants.js';
import {
  perspective, multiply, translation, rotationX, rotationY, rotationZ, scaling,
  cameraBasis, viewRotation, frustumPlanes, boxInFrustum,
} from './math.js';
import { MODEL_DEFS, buildModelMesh, skinLayer } from './models.js';
import { MAX_WEATHER_QUADS } from './weather.js';

const CHUNK_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aTex;
layout(location = 2) in vec4 aLight;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform float uTime;
out vec3 vUV;
out vec2 vLight;
out float vShade;
out float vDist;
const float AO[4] = float[4](0.42, 0.62, 0.8, 1.0);
void main() {
  vec3 p = aPos.xyz / 16.0 + uOffset;
  vec2 uv = aTex.xy / 16.0;
  if (mod(aPos.w, 2.0) > 0.5) uv += vec2(uTime * 0.021, uTime * 0.034);
  vUV = vec3(uv, aTex.z + aTex.w * 256.0);
  vLight = aLight.xy / 240.0;
  vShade = AO[int(aLight.z)] * aLight.w / 255.0;
  vDist = length(p);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const LIGHT_FN = `
vec3 lightOf(vec2 l) {
  float sky = pow(0.85, (1.0 - l.x) * 15.0) * uDaylight;
  float blk = l.y > 0.0 ? pow(0.85, (1.0 - l.y) * 15.0) : 0.0;
  vec3 light = max(uSkyTint * sky, vec3(1.0, 0.86, 0.66) * blk * 1.08);
  return max(light, uAmbient);
}`;

const CHUNK_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uDaylight;
uniform vec3 uSkyTint;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform int uTranslucent;
uniform float uBrightness;
uniform vec4 uOverlay;
in vec3 vUV;
in vec2 vLight;
in float vShade;
in float vDist;
out vec4 outColor;
${LIGHT_FN}
void main() {
  vec4 tex = texture(uTex, vUV);
  if (uTranslucent == 0 && tex.a < 0.5) discard;
  if (uTranslucent == 1 && tex.a < 0.02) discard;
  vec3 color = tex.rgb * lightOf(vLight) * vShade * uBrightness;
  color = mix(color, uOverlay.rgb, uOverlay.a);
  float fog = smoothstep(uFog.x, uFog.y, vDist);
  float alpha = uTranslucent == 1 ? mix(tex.a, 1.0, fog) : 1.0;
  outColor = vec4(mix(color, uFogColor, fog), alpha);
}`;

const ENTITY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aShade;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUV;
out float vShade;
out float vDist;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  vUV = aUV;
  vShade = aShade;
  vDist = length(p.xyz);
  gl_Position = uViewProj * p;
}`;

const ENTITY_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uSkins;
uniform float uLayer;
uniform vec3 uLight;
uniform vec4 uOverlay;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uAlphaMode;
in vec2 vUV;
in float vShade;
in float vDist;
out vec4 outColor;
void main() {
  vec4 tex = texture(uSkins, vec3(vUV, uLayer));
  if (uAlphaMode < 0.5 && tex.a < 0.5) discard;
  if (tex.a < 0.02) discard;
  vec3 color = tex.rgb * uLight * vShade;
  color = mix(color, uOverlay.rgb, uOverlay.a);
  float fog = smoothstep(uFog.x, uFog.y, vDist);
  outColor = vec4(mix(color, uFogColor, fog), uAlphaMode < 0.5 ? 1.0 : tex.a);
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
uniform float uShowSun;
uniform float uCelestial;
uniform float uCloudCover;
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
  col += uSunset * uSunsetAmt * pow(toSun, 5.0) * (1.0 - clamp(abs(h) * 2.5, 0.0, 1.0)) * 0.6 * uShowSun;

  if (uNight > 0.01 && (h > 0.0 || uShowSun < 0.5)) {
    vec3 a = abs(dir);
    vec3 cube = dir / max(a.x, max(a.y, a.z));
    float s = hash3(floor(cube * 190.0));
    if (s > 0.998) col += vec3(0.85, 0.88, 1.0) * uNight * uCelestial * (uShowSun > 0.5 ? smoothstep(0.0, 0.2, h) : 0.6) * (0.4 + 0.6 * (s - 0.998) / 0.002);
  }
  if (uShowSun > 0.5) {
    float sun = disc(dir, uSunDir, 0.075);
    col = mix(col, vec3(1.0, 0.96, 0.82), sun * uCelestial);
    col += vec3(1.0, 0.85, 0.6) * pow(toSun, 60.0) * 0.35 * (1.0 - uNight) * uCelestial;
    vec3 moonDir = -uSunDir;
    if (disc(dir, moonDir, 0.05) > 0.0) {
      float d = dot(dir, moonDir);
      vec3 r = normalize(cross(moonDir, vec3(0.0, 0.0, 1.0)));
      vec3 u = cross(r, moonDir);
      vec2 q = vec2(dot(dir, r), dot(dir, u)) / d;
      float crater = hash2(floor(q * 60.0)) > 0.75 ? 0.82 : 1.0;
      col = mix(col, vec3(0.86, 0.88, 0.94) * crater, 0.95 * uCelestial);
    }
    // A flat layer of blocky clouds drifting east.
    if (h > 0.0 && uCamPos.y < uCloudY) {
      float t = (uCloudY - uCamPos.y) / h;
      vec2 p = uCamPos.xz + dir.xz * t + vec2(uTime * 1.6, 0.0);
      vec2 cell = floor(p / 12.0);
      float n = valueNoise(cell * 0.11) * 0.7 + valueNoise(cell * 0.37) * 0.3;
      if (n > 0.6 - uCloudCover * 0.32) {
        float fade = 1.0 - smoothstep(180.0, 900.0, t);
        col = mix(col, uCloudColor, (0.88 + uCloudCover * 0.1) * fade);
      }
    }
  }
  outColor = vec4(col, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform vec3 uScale;
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
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vUV;
out vec4 vColor;
out float vDist;
void main() {
  vUV = aUV;
  vColor = aColor;
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
in vec4 vColor;
in float vDist;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (tex.a < 0.5) discard;
  outColor = vec4(mix(tex.rgb * vColor.rgb, uFogColor, smoothstep(uFog.x, uFog.y, vDist)), 1.0);
}`;

// Rain, snow and lightning: textured, alpha-blended quads that never write depth.
const WEATHER_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec3 uFogColor;
uniform vec2 uFog;
in vec3 vUV;
in vec4 vColor;
in float vDist;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  float a = tex.a * vColor.a;
  if (a < 0.02) discard;
  outColor = vec4(mix(tex.rgb * vColor.rgb, uFogColor, smoothstep(uFog.x, uFog.y, vDist)), a);
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

// The 12 edges of a unit cube, for outlines.
const CUBE_EDGES = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
  0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0,
  0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1,
]);

const MAX_PARTICLES = 1024;
const PARTICLE_FLOATS = 10;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser does not support WebGL2, which the game needs to draw the world.');
    this.gl = gl;
    this.canvas = canvas;
    this.chunkProgram = compile(gl, CHUNK_VS, CHUNK_FS);
    this.entityProgram = compile(gl, ENTITY_VS, ENTITY_FS);
    this.skyProgram = compile(gl, SKY_VS, SKY_FS);
    this.lineProgram = compile(gl, LINE_VS, LINE_FS);
    this.particleProgram = compile(gl, PARTICLE_VS, PARTICLE_FS);
    this.weatherProgram = compile(gl, PARTICLE_VS, WEATHER_FS);
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

    this.beamVao = gl.createVertexArray();
    gl.bindVertexArray(this.beamVao);
    this.beamBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 6 * 4 * 64, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.particleData = new Float32Array(MAX_PARTICLES * 4 * PARTICLE_FLOATS);
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    const stride = PARTICLE_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);

    this.weatherVao = gl.createVertexArray();
    gl.bindVertexArray(this.weatherVao);
    this.weatherBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_WEATHER_QUADS * 4 * PARTICLE_FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);

    this.models = new Map();
    this.itemMeshes = new Map();
    this.overlayMeshes = new Map();
    this.itemMeshBuilder = null;
    this.overlayBuilder = null;
    this.stats = { chunks: 0, quads: 0, entities: 0 };
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

  uploadArray(data, size, count, mips) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, count, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (mips) {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 3);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  uploadTextures(textures) {
    this.texture = this.uploadArray(textures.data, textures.tileSize, textures.count, true);
  }

  uploadSkins(skins) {
    this.skins = this.uploadArray(skins.data, skins.size, skins.count, false);
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
    gl.vertexAttribPointer(0, 4, gl.SHORT, false, 16, 0);
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

  // Item meshes (blocks and thick sprites) are built once per item and cached.
  itemMesh(key) {
    if (!this.itemMeshes.has(key)) {
      const built = this.itemMeshBuilder(key);
      this.itemMeshes.set(key, built ? { mesh: this.createMesh(built.data, built.quads), translucent: built.translucent, sprite: built.sprite } : null);
    }
    return this.itemMeshes.get(key);
  }

  modelMesh(name) {
    if (!this.models.has(name)) {
      const gl = this.gl;
      const def = MODEL_DEFS[name];
      const { data, ranges } = buildModelMesh(def);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
      gl.bindVertexArray(null);
      const parts = def.parts.map((p, i) => ({ ...p, range: ranges[i] }));
      this.models.set(name, { vao, parts, layer: skinLayer(def), def });
    }
    return this.models.get(name);
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

  setChunkUniforms(cp, frame, viewProj, fogColor, fog) {
    const gl = this.gl;
    const { sky } = frame;
    gl.useProgram(cp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniform1i(cp.u.uTex, 0);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, viewProj);
    gl.uniform1f(cp.u.uDaylight, sky.daylight);
    gl.uniform3fv(cp.u.uSkyTint, sky.skyTint);
    gl.uniform3fv(cp.u.uAmbient, frame.dim.ambient);
    gl.uniform3fv(cp.u.uFogColor, fogColor);
    gl.uniform2f(cp.u.uFog, fog[0], fog[1]);
    gl.uniform1f(cp.u.uTime, frame.time);
    gl.uniform1f(cp.u.uBrightness, 1);
    gl.uniform4f(cp.u.uOverlay, 0, 0, 0, 0);
    gl.uniform1i(cp.u.uTranslucent, 0);
  }

  render(frame) {
    const gl = this.gl;
    this.resize();
    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / height;
    const { cam, sky, dim } = frame;
    const far = frame.renderDistance * CHUNK + 48;
    const basis = cameraBasis(frame.yaw, frame.pitch);
    const proj = perspective(frame.fov, aspect, 0.06, far);
    let view = viewRotation(basis);
    if (frame.roll) view = multiply(rotationZ(frame.roll), view);
    const viewProj = multiply(proj, view);
    const reach = frame.renderDistance * CHUNK;
    let fogColor;
    let fog;
    if (frame.underwater) {
      fogColor = [0.04 * sky.daylight + 0.02, 0.16 * sky.daylight + 0.03, 0.34 * sky.daylight + 0.05];
      fog = [0, 22];
    } else if (frame.inLava) {
      fogColor = [0.7, 0.25, 0.05];
      fog = [0, 2];
    } else if (dim.fogColor) {
      fogColor = dim.fogColor;
      fog = [reach * dim.fogNear, reach * dim.fogFar];
    } else {
      fogColor = sky.horizon;
      fog = [reach * 0.55, reach - 6];
    }
    this.frame = { viewProj, fogColor, fog, cam, basis, aspect };

    gl.viewport(0, 0, width, height);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!frame.underwater && !frame.inLava && dim.sky !== 'none') this.drawSky(frame, basis, aspect);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const cp = this.chunkProgram;
    this.setChunkUniforms(cp, frame, viewProj, fogColor, fog);

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

    this.drawItems(frame.items, frame, cam);
    this.drawEntities(frame.entities, frame, viewProj, fogColor, fog);

    if (frame.crack) this.drawCrack(frame.crack, frame, cam, viewProj, fogColor, fog);
    if (frame.target) this.drawOutline(frame.target, viewProj, cam);
    if (frame.beams?.length) this.drawBeams(frame.beams, viewProj, cam);
    this.drawParticles(frame, viewProj, basis, fogColor, fog);

    // Translucent pass: water, ice and portals, far to near, both sides visible.
    this.setChunkUniforms(cp, frame, viewProj, fogColor, fog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform1i(cp.u.uTranslucent, 1);
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

    if (frame.weather) this.drawWeather(frame.weather, viewProj, fogColor, fog);
    if (frame.hand) this.drawHand(frame, aspect);

    gl.bindVertexArray(null);
    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  }

  drawSky(frame, basis, aspect) {
    const gl = this.gl;
    const { sky, dim } = frame;
    const p = this.skyProgram;
    gl.useProgram(p.program);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    const tanY = Math.tan(frame.fov / 2);
    const end = dim.sky === 'end';
    gl.uniform3fv(p.u.uForward, basis.forward);
    gl.uniform3fv(p.u.uRight, basis.right);
    gl.uniform3fv(p.u.uUp, basis.up);
    gl.uniform2f(p.u.uTan, tanY * aspect, tanY);
    gl.uniform3fv(p.u.uSunDir, sky.sunDir);
    gl.uniform3fv(p.u.uZenith, end ? [0.05, 0.02, 0.08] : sky.zenith);
    gl.uniform3fv(p.u.uHorizon, end ? dim.fogColor : sky.horizon);
    gl.uniform3fv(p.u.uSunset, sky.sunsetColor);
    gl.uniform1f(p.u.uSunsetAmt, sky.sunset);
    gl.uniform1f(p.u.uNight, end ? 1 : sky.night);
    gl.uniform3fv(p.u.uCamPos, frame.cam);
    gl.uniform1f(p.u.uTime, frame.time);
    gl.uniform3fv(p.u.uCloudColor, sky.cloudColor);
    gl.uniform1f(p.u.uCloudY, 168);
    gl.uniform1f(p.u.uShowSun, end ? 0 : 1);
    gl.uniform1f(p.u.uCelestial, sky.celestial ?? 1);
    gl.uniform1f(p.u.uCloudCover, sky.cloudCover ?? 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  }

  // Dropped items, primed TNT, thrown pearls: item meshes drawn with the chunk shader.
  drawItems(items, frame, cam) {
    if (!items?.length) return;
    const gl = this.gl;
    const cp = this.chunkProgram;
    const { viewProj } = this.frame;
    for (const it of items) {
      const entry = this.itemMesh(it.key);
      if (!entry?.mesh) continue;
      let model = translation(it.pos[0] - cam[0], it.pos[1] - cam[1], it.pos[2] - cam[2]);
      model = multiply(model, rotationY(it.yaw ?? 0));
      if (it.pitch) model = multiply(model, rotationX(it.pitch));
      model = multiply(model, scaling(it.scale));
      model = multiply(model, translation(-0.5, it.sprite ? 0 : 0, -0.5));
      gl.uniformMatrix4fv(cp.u.uViewProj, false, multiply(viewProj, model));
      gl.uniform3f(cp.u.uOffset, 0, 0, 0);
      gl.uniform1f(cp.u.uBrightness, it.light);
      gl.uniform4fv(cp.u.uOverlay, it.overlay ?? [0, 0, 0, 0]);
      gl.uniform1i(cp.u.uTranslucent, entry.translucent ? 1 : 0);
      if (entry.translucent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(entry.mesh.vao);
      gl.drawElements(gl.TRIANGLES, entry.mesh.count, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
    }
    gl.uniformMatrix4fv(cp.u.uViewProj, false, viewProj);
    gl.uniform1f(cp.u.uBrightness, 1);
    gl.uniform4f(cp.u.uOverlay, 0, 0, 0, 0);
    gl.uniform1i(cp.u.uTranslucent, 0);
  }

  drawEntities(list, frame, viewProj, fogColor, fog) {
    this.stats.entities = list?.length ?? 0;
    if (!list?.length) return;
    const gl = this.gl;
    const ep = this.entityProgram;
    gl.useProgram(ep.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skins);
    gl.uniform1i(ep.u.uSkins, 0);
    gl.uniformMatrix4fv(ep.u.uViewProj, false, viewProj);
    gl.uniform3fv(ep.u.uFogColor, fogColor);
    gl.uniform2f(ep.u.uFog, fog[0], fog[1]);
    gl.disable(gl.CULL_FACE);
    const cam = frame.cam;
    for (const ent of list) {
      const model = this.modelMesh(ent.model);
      const alpha = ent.model === 'crystal';
      if (alpha) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.uniform1f(ep.u.uAlphaMode, alpha ? 1 : 0);
      gl.uniform1f(ep.u.uLayer, model.layer);
      gl.uniform3fv(ep.u.uLight, ent.light);
      gl.uniform4fv(ep.u.uOverlay, ent.overlay ?? [0, 0, 0, 0]);
      let root = translation(ent.pos[0] - cam[0], ent.pos[1] - cam[1], ent.pos[2] - cam[2]);
      root = multiply(root, rotationY(ent.yaw));
      if (ent.pitch) root = multiply(root, rotationX(ent.pitch));
      if (ent.roll) root = multiply(root, rotationZ(ent.roll));
      root = multiply(root, scaling(ent.scale / 16));
      if (ent.offset) root = multiply(root, translation(...ent.offset));
      const pose = {};
      model.def.anim(ent.state, ent.t, pose);
      const transforms = {};
      gl.bindVertexArray(model.vao);
      for (const part of model.parts) {
        const a = pose[part.name] ?? {};
        if (a.hidden) continue;
        const r0 = part.rot ?? [0, 0, 0];
        const r = a.rot ?? [0, 0, 0];
        const pos = a.pos ?? [0, 0, 0];
        let m = multiply(part.parent ? transforms[part.parent] : root, translation(part.pivot[0] + pos[0], part.pivot[1] + pos[1], part.pivot[2] + pos[2]));
        const rz = r0[2] + r[2];
        const ry = r0[1] + r[1];
        const rx = r0[0] + r[0];
        if (rz) m = multiply(m, rotationZ(rz));
        if (ry) m = multiply(m, rotationY(ry));
        if (rx) m = multiply(m, rotationX(rx));
        transforms[part.name] = m;
        gl.uniformMatrix4fv(ep.u.uModel, false, m);
        gl.drawArrays(gl.TRIANGLES, part.range.start, part.range.count);
      }
      if (alpha) gl.disable(gl.BLEND);
    }
    gl.enable(gl.CULL_FACE);
  }

  drawOutline(target, viewProj, cam) {
    const gl = this.gl;
    const lp = this.lineProgram;
    gl.useProgram(lp.program);
    gl.uniformMatrix4fv(lp.u.uViewProj, false, viewProj);
    gl.uniform4f(lp.u.uColor, 0.02, 0.02, 0.02, 1);
    gl.bindVertexArray(this.lineVao);
    for (const b of target.boxes) {
      gl.uniform3f(lp.u.uOffset, target.x + b[0] - cam[0] - 0.002, target.y + b[1] - cam[1] - 0.002, target.z + b[2] - cam[2] - 0.002);
      gl.uniform3f(lp.u.uScale, b[3] - b[0] + 0.004, b[4] - b[1] + 0.004, b[5] - b[2] + 0.004);
      gl.drawArrays(gl.LINES, 0, 24);
    }
  }

  drawBeams(beams, viewProj, cam) {
    const gl = this.gl;
    const lp = this.lineProgram;
    const data = new Float32Array(beams.length * 6);
    beams.forEach(([a, b], i) => {
      data.set([a[0] - cam[0], a[1] - cam[1], a[2] - cam[2], b[0] - cam[0], b[1] - cam[1], b[2] - cam[2]], i * 6);
    });
    gl.useProgram(lp.program);
    gl.uniformMatrix4fv(lp.u.uViewProj, false, viewProj);
    gl.uniform3f(lp.u.uOffset, 0, 0, 0);
    gl.uniform3f(lp.u.uScale, 1, 1, 1);
    gl.uniform4f(lp.u.uColor, 1, 0.55, 0.95, 1);
    gl.bindVertexArray(this.beamVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.drawArrays(gl.LINES, 0, beams.length * 2);
  }

  drawCrack(crack, frame, cam, viewProj, fogColor, fog) {
    const key = `${crack.stage}:${crack.id}`;
    if (!this.overlayMeshes.has(key)) {
      const built = this.overlayBuilder(crack.id, crack.stage);
      this.overlayMeshes.set(key, this.createMesh(built.data, built.quads));
    }
    const mesh = this.overlayMeshes.get(key);
    if (!mesh) return;
    const gl = this.gl;
    const cp = this.chunkProgram;
    this.setChunkUniforms(cp, frame, viewProj, fogColor, fog);
    gl.uniform1i(cp.u.uTranslucent, 1);
    gl.uniform1f(cp.u.uBrightness, 1);
    gl.uniform3f(cp.u.uOffset, crack.x - cam[0], crack.y - cam[1], crack.z - cam[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -4);
    gl.depthMask(false);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
    gl.uniform1i(cp.u.uTranslucent, 0);
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
      const uw = p.uw ?? 0.25;
      const corners = [[-1, -1, p.u0, p.v0 + uw], [1, -1, p.u0 + uw, p.v0 + uw], [1, 1, p.u0 + uw, p.v0], [-1, 1, p.u0, p.v0]];
      for (const [sx, sy, u, v] of corners) {
        data[o++] = cx + (right[0] * sx + up[0] * sy) * s;
        data[o++] = cy + (right[1] * sx + up[1] * sy) * s;
        data[o++] = cz + (right[2] * sx + up[2] * sy) * s;
        data[o++] = u;
        data[o++] = v;
        data[o++] = p.layer;
        data[o++] = p.color[0];
        data[o++] = p.color[1];
        data[o++] = p.color[2];
        data[o++] = 1;
      }
    }
    const pp = this.particleProgram;
    gl.useProgram(pp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
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

  drawWeather(weather, viewProj, fogColor, fog) {
    const gl = this.gl;
    const wp = this.weatherProgram;
    gl.useProgram(wp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniformMatrix4fv(wp.u.uViewProj, false, viewProj);
    gl.uniform1i(wp.u.uTex, 0);
    gl.uniform3fv(wp.u.uFogColor, fogColor);
    gl.uniform2f(wp.u.uFog, fog[0], fog[1]);
    gl.bindVertexArray(this.weatherVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.weatherBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, weather.data, 0, weather.quads * 4 * PARTICLE_FLOATS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES, weather.quads * 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // The held item (or bare arm), drawn last over a cleared depth buffer.
  drawHand(frame, aspect) {
    const gl = this.gl;
    const hand = frame.hand;
    const entry = this.itemMesh(hand.key ?? '__arm');
    if (!entry?.mesh) return;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const swing = hand.swing;
    const s = Math.sin(Math.sqrt(swing) * Math.PI);
    const s2 = Math.sin(swing * Math.PI);
    const side = Math.min(0.66, Math.tan((35 * Math.PI) / 180) * aspect * 1.05 * 0.62);
    const eat = hand.eat ? Math.abs(Math.sin(hand.eat * 30)) * 0.06 : 0;
    const pull = hand.pull ?? 0;
    let model = translation(
      side - s * 0.24 + hand.bob[0] - (hand.eat ? 0.3 : 0) - pull * 0.2,
      -0.62 + Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.1 + hand.bob[1] - s2 * 0.08 + (hand.eat ? 0.25 + eat : 0),
      -1.05 + pull * 0.1,
    );
    const sprite = entry.sprite;
    const arm = !hand.key;
    if (arm) {
      model = multiply(model, rotationY(-0.3 + s * 0.5));
      model = multiply(model, rotationX(-1.1 - s2 * 0.6));
      model = multiply(model, scaling(0.5));
      model = multiply(model, translation(-0.5, -0.5, -0.5));
    } else if (sprite) {
      model = multiply(model, rotationY(-Math.PI / 2 + 0.3 + s * 0.6 + (hand.eat ? 1.2 : 0) + pull * 0.9));
      model = multiply(model, rotationZ(0.35 - s2 * 0.6 + (hand.bow ? -0.6 : 0)));
      model = multiply(model, scaling(0.7));
      model = multiply(model, translation(-0.5, -0.3, -0.5));
    } else {
      model = multiply(model, rotationY(Math.PI / 4 + s * 0.6));
      model = multiply(model, rotationX(0.12 - s2 * 0.5));
      model = multiply(model, rotationZ(s2 * 0.25));
      model = multiply(model, scaling(0.3));
      model = multiply(model, translation(-0.5, -0.5, -0.5));
    }
    const proj = perspective((70 * Math.PI) / 180, aspect, 0.05, 10);
    const cp = this.chunkProgram;
    gl.useProgram(cp.program);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, multiply(proj, model));
    gl.uniform3f(cp.u.uOffset, 0, 0, 0);
    gl.uniform2f(cp.u.uFog, 1000, 1001);
    gl.uniform1f(cp.u.uBrightness, hand.light);
    // Enchanted items shimmer purple.
    if (hand.glint) gl.uniform4f(cp.u.uOverlay, 0.62, 0.36, 1, 0.16 + 0.1 * Math.sin(frame.time * 3));
    else gl.uniform4f(cp.u.uOverlay, 0, 0, 0, 0);
    gl.uniform1i(cp.u.uTranslucent, entry.translucent ? 1 : 0);
    if (entry.translucent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(entry.mesh.vao);
    gl.drawElements(gl.TRIANGLES, entry.mesh.count, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.uniform1i(cp.u.uTranslucent, 0);
  }
}
