// WebGL2 renderer: sky, chunk meshes, water, mobs, dropped items, particles,
// block outline and cracks, crystal beams and the held item. Everything is
// drawn relative to the camera so coordinates stay small and precise.
//
// Two pipelines share the drawing code. "Vanilla" draws straight to the screen
// with Minecraft-style baked lighting. "Shaders" (src/shaders.js) draws into a
// floating-point target with real sun lighting, optional sun shadows, water
// reflections and a richer sky, then adds bloom and god rays and tone maps.
import { CHUNK } from './constants.js';
import {
  perspective, multiply, translation, rotationX, rotationY, rotationZ, scaling,
  cameraBasis, viewRotation, frustumPlanes, boxInFrustum,
} from './math.js';
import { MODEL_DEFS, buildModelMesh, skinLayer } from './models.js';
import { MAX_WEATHER_QUADS } from './weather.js';
import * as FX from './shaders.js';

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
out vec3 vPos;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  vUV = aUV;
  vShade = aShade;
  vDist = length(p.xyz);
  vPos = p.xyz;
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

// The same shader, writing linear colour for the shader pipeline's HDR target.
const linearOut = (fs) => fs.replace(/\}\s*$/, '  outColor.rgb = pow(max(outColor.rgb, vec3(0.0)), vec3(2.2));\n}');

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLinear = (c) => c.map((v) => Math.max(0, v) ** 2.2);

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
    const chunk = compile(gl, CHUNK_VS, CHUNK_FS);
    this.vanilla = {
      chunk,
      terrain: chunk,
      entity: compile(gl, ENTITY_VS, ENTITY_FS),
      sky: compile(gl, SKY_VS, SKY_FS),
      line: compile(gl, LINE_VS, LINE_FS),
      particle: compile(gl, PARTICLE_VS, PARTICLE_FS),
      weather: compile(gl, PARTICLE_VS, WEATHER_FS),
    };
    this.P = this.vanilla;
    this.fx = null;
    this.fancy = false;
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

  // ---------------------------------------------------------------- shader pipeline setup

  // Builds the shader pipeline the first time it's asked for. Returns false
  // (and stays on vanilla graphics) where the GPU can't render to float targets.
  ensureFancy() {
    if (this.fx) return true;
    if (this.fxFailed) return false;
    const gl = this.gl;
    try {
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('floating-point render targets are not supported');
      this.fx = {
        chunk: compile(gl, CHUNK_VS, linearOut(CHUNK_FS)),
        terrain: compile(gl, FX.TERRAIN_VS, FX.TERRAIN_FS),
        entity: compile(gl, ENTITY_VS, FX.ENTITY_FS),
        sky: compile(gl, SKY_VS, FX.SKY_FS),
        line: compile(gl, LINE_VS, linearOut(LINE_FS)),
        particle: compile(gl, PARTICLE_VS, linearOut(PARTICLE_FS)),
        weather: compile(gl, PARTICLE_VS, linearOut(WEATHER_FS)),
        shadow: compile(gl, FX.SHADOW_VS, FX.SHADOW_FS),
        entityShadow: compile(gl, FX.ENTITY_SHADOW_VS, FX.ENTITY_SHADOW_FS),
        bright: compile(gl, FX.POST_VS, FX.BRIGHT_FS),
        blur: compile(gl, FX.POST_VS, FX.BLUR_FS),
        rays: compile(gl, FX.POST_VS, FX.RAYS_FS),
        composite: compile(gl, FX.POST_VS, FX.COMPOSITE_FS),
      };
      this.createShadowMap();
      return true;
    } catch (err) {
      console.warn(`Shaders are unavailable, using vanilla graphics: ${err.message}`);
      this.fxFailed = true;
      this.fx = null;
      return false;
    }
  }

  // A texture to render into, with its framebuffer.
  target(w, h, internal, format, type, filter, depth = null) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  freeTarget(t) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  // The scene's HDR colour and depth, and quarter-size buffers for bloom and god rays.
  ensureTargets(w, h) {
    const t = this.targets;
    if (t && t.w === w && t.h === h) return;
    const gl = this.gl;
    if (t) {
      for (const k of ['scene', 'bloomA', 'bloomB', 'rays']) this.freeTarget(t[k]);
      gl.deleteTexture(t.depth);
    }
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const qw = Math.max(1, w >> 2);
    const qh = Math.max(1, h >> 2);
    this.targets = {
      w, h, depth,
      scene: this.target(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, depth),
      bloomA: this.target(qw, qh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR),
      bloomB: this.target(qw, qh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR),
      rays: this.target(qw, qh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR),
    };
  }

  createShadowMap() {
    const gl = this.gl;
    const size = FX.SHADOW_SIZE;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete shadow framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowMap = { tex, fbo, size };
    // Start fully lit, so a frame drawn before the first shadow pass has no shadows.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Sun, moon, sky and torch light for the shader pipeline, from the sky state.
  fancyLight(frame) {
    const { sky, dim } = frame;
    const sd = sky.sunDir;
    const overworld = dim.sky === 'overworld';
    const cloud = sky.cloudCover ?? 0;
    const clear = 1 - cloud * 0.85;
    const sunUp = smoothstep(-0.02, 0.14, sd[1]);
    const moonUp = smoothstep(-0.02, 0.14, -sd[1]);
    const useSun = sd[1] >= 0;
    const lightDir = useSun ? sd : [-sd[0], -sd[1], -sd[2]];
    const warm = mix3([1.0, 0.36, 0.1], [1.0, 0.88, 0.74], smoothstep(0.02, 0.42, sd[1]));
    const sunLight = useSun ? warm.map((v) => v * 0.9 * sunUp * clear) : [0.03, 0.04, 0.075].map((v) => v * moonUp * clear);
    const day = Math.min(1, Math.max(0, (sky.daylight - 0.16) / 0.84));
    let skyLight = mix3([0.012, 0.016, 0.03], [0.13, 0.17, 0.25], day);
    skyLight = mix3(skyLight, [0.16, 0.11, 0.1].map((v) => v * Math.max(day, 0.4)), sky.sunset * 0.35);
    const grey = (skyLight[0] + skyLight[1] + skyLight[2]) / 3;
    skyLight = mix3(skyLight, [grey, grey, grey * 1.05], cloud * 0.6);
    const shadows = frame.graphics === 'shadows';
    return {
      lightDir,
      sunLight: overworld ? sunLight : [0, 0, 0],
      skyLight: overworld ? skyLight : [0, 0, 0],
      blockLight: [1.05, 0.7, 0.36],
      ambient: overworld ? [0.004, 0.004, 0.006] : toLinear(dim.ambient).map((v) => v * 0.9),
      shadowOn: overworld && shadows && !frame.title ? (useSun ? sunUp : moonUp) * (1 - cloud) : 0,
      waving: overworld ? 1 + cloud * 1.6 : 0.6,
      haze: overworld ? 0.0022 + cloud * 0.004 : 0,
      day,
      sunUp,
      clear,
    };
  }

  // Orthographic view from the light around the camera; camera-relative
  // positions in, shadow clip space out (before distortion). The centre snaps
  // to the map's texels so shadows don't crawl as you walk.
  shadowMatrix(cam, lightDir) {
    const L = lightDir;
    let r = [L[1] * 1 - L[2] * 0, L[2] * 0 - L[0] * 1, 0];
    const rl = Math.hypot(r[0], r[1], r[2]) || 1;
    r = r.map((v) => v / rl);
    const u = [r[1] * L[2] - r[2] * L[1], r[2] * L[0] - r[0] * L[2], r[0] * L[1] - r[1] * L[0]];
    const R = 96;
    const D = 256;
    const step = (R * 2 / FX.SHADOW_SIZE) * 0.15;
    const cx = r[0] * cam[0] + r[1] * cam[1] + r[2] * cam[2];
    const cy = u[0] * cam[0] + u[1] * cam[1] + u[2] * cam[2];
    const ox = cx - Math.round(cx / step) * step;
    const oy = cy - Math.round(cy / step) * step;
    const m = new Float32Array(16);
    m[0] = r[0] / R; m[4] = r[1] / R; m[8] = r[2] / R; m[12] = ox / R;
    m[1] = u[0] / R; m[5] = u[1] / R; m[9] = u[2] / R; m[13] = oy / R;
    m[2] = -L[0] / D; m[6] = -L[1] / D; m[10] = -L[2] / D; m[14] = 0;
    m[15] = 1;
    return { m, radius: R };
  }

  setSkyUniforms(p, frame) {
    const gl = this.gl;
    const { sky, dim } = frame;
    const end = dim.sky === 'end';
    gl.uniform3fv(p.u.uZenith ?? null, end ? [0.05, 0.02, 0.08] : sky.zenith);
    gl.uniform3fv(p.u.uHorizon ?? null, end ? dim.fogColor : sky.horizon);
    gl.uniform3fv(p.u.uSunDir ?? null, sky.sunDir);
    gl.uniform3fv(p.u.uSunset ?? null, sky.sunsetColor);
    gl.uniform1f(p.u.uSunsetAmt ?? null, end ? 0 : sky.sunset);
    gl.uniform1f(p.u.uNight ?? null, end ? 1 : sky.night);
    gl.uniform1f(p.u.uCloudCover ?? null, sky.cloudCover ?? 0);
  }

  // Lighting, fog and shadow uniforms shared by the shader pipeline's terrain and mobs.
  setLitUniforms(p, frame) {
    const gl = this.gl;
    const L = this.light;
    const f = this.frame;
    this.setSkyUniforms(p, frame);
    gl.uniform3fv(p.u.uLightDir ?? null, L.lightDir);
    gl.uniform3fv(p.u.uSunLight ?? null, L.sunLight);
    gl.uniform3fv(p.u.uSkyLight ?? null, L.skyLight);
    gl.uniform3fv(p.u.uBlockLight ?? null, L.blockLight);
    gl.uniform3fv(p.u.uAmbient ?? null, L.ambient);
    gl.uniform3fv(p.u.uFogColor ?? null, f.fogColor);
    gl.uniform2f(p.u.uFog ?? null, f.fog[0], f.fog[1]);
    gl.uniform1f(p.u.uSkyFog ?? null, f.skyFog ? 1 : 0);
    gl.uniform1f(p.u.uHaze ?? null, f.skyFog ? L.haze : 0);
    gl.uniform1f(p.u.uShadowOn ?? null, L.shadowOn);
    gl.uniformMatrix4fv(p.u.uShadowMat ?? null, false, this.shadow.m);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap.tex);
    gl.uniform1i(p.u.uShadow ?? null, 1);
    gl.activeTexture(gl.TEXTURE0);
  }

  setChunkUniforms(cp, frame, viewProj, fogColor, fog) {
    const gl = this.gl;
    const { sky } = frame;
    gl.useProgram(cp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniform1i(cp.u.uTex, 0);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, viewProj);
    gl.uniform1f(cp.u.uTime ?? null, frame.time);
    gl.uniform1i(cp.u.uTranslucent, 0);
    gl.uniform3f(cp.u.uOffset, 0, 0, 0);
    if (cp === this.fx?.terrain) {
      this.setLitUniforms(cp, frame);
      gl.uniform1f(cp.u.uWaving ?? null, this.light.waving);
      gl.uniform3fv(cp.u.uCamWrap ?? null, this.camWrap);
      gl.uniform1f(cp.u.uUnderwater ?? null, frame.underwater ? 1 : 0);
      return;
    }
    gl.uniform1f(cp.u.uDaylight, sky.daylight);
    gl.uniform3fv(cp.u.uSkyTint, sky.skyTint);
    gl.uniform3fv(cp.u.uAmbient, frame.dim.ambient);
    gl.uniform3fv(cp.u.uFogColor, fogColor);
    gl.uniform2f(cp.u.uFog, fog[0], fog[1]);
    gl.uniform1f(cp.u.uBrightness, 1);
    gl.uniform4f(cp.u.uOverlay, 0, 0, 0, 0);
  }

  // ---------------------------------------------------------------- frame

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
    let skyFog = false;
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
      skyFog = true;
    }
    this.frame = { viewProj, fogColor, fog, cam, basis, aspect, skyFog };

    // Pick the pipeline.
    const fancy = frame.graphics !== 'vanilla' && frame.graphics !== undefined && this.ensureFancy();
    this.fancy = fancy;
    this.P = fancy ? this.fx : this.vanilla;
    if (fancy) {
      this.ensureTargets(width, height);
      this.light = this.fancyLight(frame);
      this.camWrap = cam.map((v) => ((v % 1024) + 1024) % 1024);
      this.shadow = this.shadowMatrix(cam, this.light.lightDir);
    }

    // Chunks in view, near to far.
    const planes = frustumPlanes(viewProj);
    const visible = [];
    for (const c of frame.chunks) {
      if (!c.visible || !c.gpu) continue;
      const ox = c.cx * CHUNK - cam[0];
      const oz = c.cz * CHUNK - cam[2];
      if (fancy && this.light.shadowOn > 0) (this.shadowCasters ??= []).push(c);
      if (!boxInFrustum(planes, ox, c.gpu.minY - cam[1], oz, ox + CHUNK, c.gpu.maxY - cam[1], oz + CHUNK)) continue;
      visible.push({ c, ox, oz, d: (ox + 8) * (ox + 8) + (oz + 8) * (oz + 8) });
    }
    visible.sort((a, b) => a.d - b.d);
    if (fancy && this.light.shadowOn > 0) {
      this.drawShadowMap(frame, this.shadowCasters ?? []);
      this.shadowCasters = [];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fancy ? this.targets.scene.fbo : null);
    gl.viewport(0, 0, width, height);
    const clear = fancy ? toLinear(fogColor) : fogColor;
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!frame.underwater && !frame.inLava && dim.sky !== 'none') this.drawSky(frame, basis, aspect);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const tp = this.P.terrain;
    this.setChunkUniforms(tp, frame, viewProj, fogColor, fog);
    let quads = 0;
    for (const v of visible) {
      const mesh = v.c.gpu.solid;
      if (!mesh) continue;
      gl.uniform3f(tp.u.uOffset, v.ox, -cam[1], v.oz);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      quads += mesh.quads;
    }

    this.drawItems(frame.items, frame, cam);
    this.drawEntities(frame.entities, frame, viewProj, fogColor, fog);

    if (frame.crack) this.drawCrack(frame.crack, frame, cam, viewProj, fogColor, fog);
    if (frame.target) this.drawOutline(frame.target, viewProj, cam);
    if (frame.beams?.length) this.drawBeams(frame.beams, viewProj, cam);
    if (frame.lines?.length) this.drawBeams(frame.lines, viewProj, cam, [0.12, 0.12, 0.12, 1]);
    this.drawParticles(frame, viewProj, basis, fogColor, fog);

    // Translucent pass: water, ice and portals, far to near, both sides visible.
    this.setChunkUniforms(tp, frame, viewProj, fogColor, fog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform1i(tp.u.uTranslucent, 1);
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      const mesh = v.c.gpu.water;
      if (!mesh) continue;
      gl.uniform3f(tp.u.uOffset, v.ox, -cam[1], v.oz);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
      quads += mesh.quads;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    if (frame.weather) this.drawWeather(frame.weather, viewProj, fogColor, fog);

    if (fancy) this.postProcess(frame, viewProj, width, height);
    this.P = this.vanilla;
    if (frame.hand) this.drawHand(frame, aspect);

    gl.bindVertexArray(null);
    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  }

  // Depth from the sun (or moon) for every chunk and mob near the player.
  drawShadowMap(frame, chunks) {
    const gl = this.gl;
    const fx = this.fx;
    const { m, radius } = this.shadow;
    const cam = frame.cam;
    const sm = this.shadowMap;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fbo);
    gl.viewport(0, 0, sm.size, sm.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const planes = frustumPlanes(m);
    const sp = fx.shadow;
    gl.useProgram(sp.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.uniform1i(sp.u.uTex, 0);
    gl.uniformMatrix4fv(sp.u.uShadowMat, false, m);
    gl.uniform1f(sp.u.uTime ?? null, frame.time);
    gl.uniform1f(sp.u.uWaving ?? null, this.light.waving);
    gl.uniform3fv(sp.u.uCamWrap ?? null, this.camWrap);
    const reach = radius + CHUNK;
    for (const c of chunks) {
      const mesh = c.gpu.solid;
      if (!mesh) continue;
      const ox = c.cx * CHUNK - cam[0];
      const oz = c.cz * CHUNK - cam[2];
      if (ox > reach || oz > reach || ox + CHUNK < -reach || oz + CHUNK < -reach) continue;
      if (!boxInFrustum(planes, ox, c.gpu.minY - cam[1], oz, ox + CHUNK, c.gpu.maxY - cam[1], oz + CHUNK)) continue;
      gl.uniform3f(sp.u.uOffset, ox, -cam[1], oz);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    // Mobs cast shadows too.
    if (frame.entities?.length) {
      const ep = fx.entityShadow;
      gl.useProgram(ep.program);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skins);
      gl.uniform1i(ep.u.uSkins, 0);
      gl.uniformMatrix4fv(ep.u.uShadowMat, false, m);
      for (const ent of frame.entities) {
        if (Math.abs(ent.pos[0] - cam[0]) > radius || Math.abs(ent.pos[2] - cam[2]) > radius) continue;
        this.drawEntityParts(ent, cam, ep);
      }
    }
    gl.enable(gl.CULL_FACE);
  }

  // Bloom, god rays and tone mapping, from the HDR scene to the screen.
  postProcess(frame, viewProj, width, height) {
    const gl = this.gl;
    const fx = this.fx;
    const t = this.targets;
    const L = this.light;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);
    const pass = (p, out, w, h) => {
      gl.useProgram(p.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out);
      gl.viewport(0, 0, w, h);
    };
    const bind = (unit, tex, loc) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc ?? null, unit);
    };
    const qw = t.bloomA.w;
    const qh = t.bloomA.h;
    // Bloom: bright parts, blurred twice in each direction.
    pass(fx.bright, t.bloomA.fbo, qw, qh);
    bind(0, t.scene.tex, fx.bright.u.uColor);
    gl.uniform2f(fx.bright.u.uTexel, 1 / width, 1 / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const k of [1, 2]) {
      pass(fx.blur, t.bloomB.fbo, qw, qh);
      bind(0, t.bloomA.tex, fx.blur.u.uSrc);
      gl.uniform2f(fx.blur.u.uDir, k / qw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(fx.blur, t.bloomA.fbo, qw, qh);
      bind(0, t.bloomB.tex, fx.blur.u.uSrc);
      gl.uniform2f(fx.blur.u.uDir, 0, k / qh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // God rays from the sun, when it's in front of you.
    const sd = frame.sky.sunDir;
    const clip = [0, 1, 2, 3].map((i) => viewProj[i] * sd[0] + viewProj[4 + i] * sd[1] + viewProj[8 + i] * sd[2]);
    const facing = this.frame.basis.forward[0] * sd[0] + this.frame.basis.forward[1] * sd[1] + this.frame.basis.forward[2] * sd[2];
    let rays = 0;
    if (frame.dim.sky === 'overworld' && !frame.underwater && clip[3] > 0.001) {
      rays = smoothstep(0.1, 0.6, facing) * L.sunUp * L.clear * (frame.sky.celestial ?? 1);
    }
    pass(fx.rays, t.rays.fbo, qw, qh);
    if (rays > 0.001) {
      bind(0, t.depth, fx.rays.u.uDepth);
      gl.uniform2f(fx.rays.u.uSunUv, (clip[0] / clip[3]) * 0.5 + 0.5, (clip[1] / clip[3]) * 0.5 + 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    // Composite to the screen.
    pass(fx.composite, null, width, height);
    const c = fx.composite.u;
    bind(0, t.scene.tex, c.uColor);
    bind(1, t.bloomA.tex, c.uBloom);
    bind(2, t.rays.tex, c.uRays);
    const sunCol = L.sunLight;
    const k = rays * 0.8;
    gl.uniform3f(c.uRayColor ?? null, sunCol[0] * k, sunCol[1] * k, sunCol[2] * k);
    gl.uniform1f(c.uExposure ?? null, 1.0);
    gl.uniform1f(c.uUnderwater ?? null, frame.underwater ? 1 : 0);
    gl.uniform1f(c.uTime ?? null, frame.time);
    gl.uniform4f(c.uTint ?? null, 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const unit of [2, 1, 0]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  drawSky(frame, basis, aspect) {
    const gl = this.gl;
    const { sky, dim } = frame;
    const p = this.P.sky;
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
    this.setSkyUniforms(p, frame);
    gl.uniform3fv(p.u.uCamPos ?? null, frame.cam);
    gl.uniform1f(p.u.uTime ?? null, frame.time);
    gl.uniform3fv(p.u.uCloudColor ?? null, sky.cloudColor);
    gl.uniform1f(p.u.uCloudY ?? null, 168);
    gl.uniform1f(p.u.uShowSun ?? null, end ? 0 : 1);
    gl.uniform1f(p.u.uCelestial ?? null, sky.celestial ?? 1);
    if (this.fancy) gl.uniform3fv(p.u.uSunLight ?? null, this.light.sunLight);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  }

  // Dropped items, primed TNT, thrown pearls: item meshes drawn with the chunk shader.
  drawItems(items, frame, cam) {
    if (!items?.length) return;
    const gl = this.gl;
    const cp = this.P.chunk;
    const { viewProj, fogColor, fog } = this.frame;
    this.setChunkUniforms(cp, frame, viewProj, fogColor, fog);
    gl.uniform1f(cp.u.uDaylight, 1);
    gl.uniform3f(cp.u.uSkyTint, 1, 1, 1);
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

  // One mob's posed parts, with the given program (scene or shadow pass).
  drawEntityParts(ent, cam, prog) {
    const gl = this.gl;
    const model = this.modelMesh(ent.model);
    gl.uniform1f(prog.u.uLayer, model.layer);
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
      if (a.scale) m = multiply(m, scaling(...a.scale));
      transforms[part.name] = m;
      gl.uniformMatrix4fv(prog.u.uModel, false, m);
      gl.drawArrays(gl.TRIANGLES, part.range.start, part.range.count);
    }
  }

  drawEntities(list, frame, viewProj, fogColor, fog) {
    this.stats.entities = list?.length ?? 0;
    if (!list?.length) return;
    const gl = this.gl;
    const ep = this.P.entity;
    const fancy = ep === this.fx?.entity;
    gl.useProgram(ep.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skins);
    gl.uniform1i(ep.u.uSkins, 0);
    gl.uniformMatrix4fv(ep.u.uViewProj, false, viewProj);
    if (fancy) {
      this.setLitUniforms(ep, frame);
    } else {
      gl.uniform3fv(ep.u.uFogColor, fogColor);
      gl.uniform2f(ep.u.uFog, fog[0], fog[1]);
    }
    gl.disable(gl.CULL_FACE);
    const cam = frame.cam;
    for (const ent of list) {
      const alpha = ent.model === 'crystal' || ent.model === 'slime';
      if (alpha) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.uniform1f(ep.u.uAlphaMode, alpha ? 1 : 0);
      if (fancy) gl.uniform2fv(ep.u.uLevels ?? null, ent.levels ?? [1, 0]);
      else gl.uniform3fv(ep.u.uLight, ent.light);
      gl.uniform4fv(ep.u.uOverlay, ent.overlay ?? [0, 0, 0, 0]);
      this.drawEntityParts(ent, cam, ep);
      if (alpha) gl.disable(gl.BLEND);
    }
    gl.enable(gl.CULL_FACE);
  }

  drawOutline(target, viewProj, cam) {
    const gl = this.gl;
    const lp = this.P.line;
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

  drawBeams(beams, viewProj, cam, color = [1, 0.55, 0.95, 1]) {
    const gl = this.gl;
    const lp = this.P.line;
    const data = new Float32Array(beams.length * 6);
    beams.forEach(([a, b], i) => {
      data.set([a[0] - cam[0], a[1] - cam[1], a[2] - cam[2], b[0] - cam[0], b[1] - cam[1], b[2] - cam[2]], i * 6);
    });
    gl.useProgram(lp.program);
    gl.uniformMatrix4fv(lp.u.uViewProj, false, viewProj);
    gl.uniform3f(lp.u.uOffset, 0, 0, 0);
    gl.uniform3f(lp.u.uScale, 1, 1, 1);
    gl.uniform4fv(lp.u.uColor, color);
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
    const cp = this.P.chunk;
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
    const pp = this.P.particle;
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
    const wp = this.P.weather;
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

  // The held item (or bare arm), drawn last over a cleared depth buffer. The
  // transforms follow Minecraft's first-person renderer: the arm, the item's
  // place in the hand, swinging, eating and drinking, and drawing a bow.
  drawHand(frame, aspect) {
    const gl = this.gl;
    const hand = frame.hand;
    // A drawn bow shows its string pulled back, in three stages as in Minecraft.
    const bowStage = hand.key === 'bow' && hand.pull > 0 ? (hand.pull >= 0.9 ? 2 : hand.pull >= 0.65 ? 1 : 0) : -1;
    const entry = this.itemMesh(bowStage >= 0 ? `bow_pulling_${bowStage}` : hand.key ?? '__arm');
    if (!entry?.mesh) return;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const deg = Math.PI / 180;
    const swing = hand.swing;
    const root = Math.sqrt(swing);
    const equip = hand.equip ?? 0;
    // Walking bob and the slight lag behind fast turns.
    let m = translation(hand.bob[0], hand.bob[1], 0);
    m = multiply(m, rotationX(hand.sway[1] * 0.15));
    m = multiply(m, rotationY(hand.sway[0] * 0.15));
    const mul = (n) => { m = multiply(m, n); };
    const armTransform = () => mul(translation(0.56, -0.52 - equip * 0.6, -0.72));
    if (!hand.key) {
      // Bare arm.
      mul(translation(-0.3 * Math.sin(root * Math.PI) + 0.64, 0.4 * Math.sin(root * Math.PI * 2) - 0.6 - equip * 0.6, -0.4 * Math.sin(swing * Math.PI) - 0.72));
      mul(rotationY(45 * deg));
      mul(rotationY(Math.sin(root * Math.PI) * 70 * deg));
      mul(rotationZ(Math.sin(swing * swing * Math.PI) * -20 * deg));
      mul(translation(-1, 3.6, 3.5));
      mul(rotationZ(120 * deg));
      mul(rotationX(200 * deg));
      mul(rotationY(-135 * deg));
      mul(translation(5.6, 0, 0));
      // The arm part: pivot at the shoulder, box 4x12x4 pixels hanging from it.
      mul(translation(-5 / 16, 2 / 16, 0));
      mul(translation(-3 / 16 - 0.375, 10 / 16, -0.5));
      mul(scaling(1, -1, 1));
    } else {
      if (hand.eat) {
        const left = Math.max(0, (1.6 - hand.eat) * 20 + 1);
        const f1 = left / 32;
        if (f1 < 0.8) mul(translation(0, Math.abs(Math.cos((left / 4) * Math.PI) * 0.1), 0));
        const f3 = 1 - f1 ** 27;
        mul(translation(f3 * 0.6, f3 * -0.5, 0));
        mul(rotationY(f3 * 90 * deg));
        mul(rotationX(f3 * 10 * deg));
        mul(rotationZ(f3 * 30 * deg));
        armTransform();
      } else if (hand.pull) {
        armTransform();
        mul(translation(-0.2785682, 0.18344387, 0.15731531));
        mul(rotationX(-13.935 * deg));
        mul(rotationY(35.3 * deg));
        mul(rotationZ(-9.785 * deg));
        const ticks = hand.pull * 20;
        let f = ticks / 20;
        f = Math.min(1, (f * f + f * 2) / 3);
        if (f > 0.1) mul(translation(0, Math.sin((ticks - 0.1) * 1.3) * (f - 0.1) * 0.004, 0));
        mul(translation(0, 0, f * 0.04));
        mul(scaling(1, 1, 1 + f * 0.2));
        mul(rotationY(-45 * deg));
      } else {
        mul(translation(-0.4 * Math.sin(root * Math.PI), 0.2 * Math.sin(root * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI)));
        armTransform();
        mul(rotationY((45 - Math.sin(swing * swing * Math.PI) * 20) * deg));
        const f1 = Math.sin(root * Math.PI);
        mul(rotationZ(f1 * -20 * deg));
        mul(rotationX(f1 * -80 * deg));
        mul(rotationY(-45 * deg));
      }
      if (entry.sprite) {
        // Tools and items: flat, turned edge-on and tipped toward the centre.
        mul(translation(1.13 / 16, 3.2 / 16, 1.13 / 16));
        mul(rotationY(-90 * deg));
        mul(rotationZ(25 * deg));
        mul(scaling(0.68));
        // Our sprite meshes face +z; Minecraft's item models face the other way.
        mul(rotationY(Math.PI));
      } else {
        // Blocks sit a little higher than Minecraft's so a side shows.
        mul(translation(-0.03, 0.1, 0));
        mul(rotationY(45 * deg));
        mul(scaling(0.4));
      }
      mul(translation(-0.5, -0.5, -0.5));
    }
    const proj = perspective((70 * Math.PI) / 180, aspect, 0.05, 10);
    const cp = this.vanilla.chunk;
    this.setChunkUniforms(cp, frame, this.frame.viewProj, this.frame.fogColor, this.frame.fog);
    gl.uniform1f(cp.u.uDaylight, 1);
    gl.uniform3f(cp.u.uSkyTint, 1, 1, 1);
    gl.uniformMatrix4fv(cp.u.uViewProj, false, multiply(proj, m));
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
