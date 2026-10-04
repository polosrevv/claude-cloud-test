// GLSL for the "Shaders" graphics setting, in the spirit of Minecraft shader
// packs: lighting is done in linear colour with a warm sun (or cool moon) that
// casts soft shadows, a blue sky fill and orange torchlight; water ripples and
// reflects the sky; leaves and plants sway; the sky gets a glowing sun, a
// moon, twinkling stars and soft lit clouds. The scene renders to a
// floating-point target, then bloom, god rays and tone mapping finish it.
//
// Every shader takes its colours in sRGB, like the rest of the game, and works
// in linear space internally.

export const SHADOW_SIZE = 2048;

const COMMON = `
const int FLAG_SCROLL = 1;
const int FLAG_WATER = 2;
const int FLAG_LEAVES = 4;
const int FLAG_PLANT = 8;
const int FLAG_TOP = 16;
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
// Shadow-map distortion: more resolution near the player, less far away.
vec2 distortShadow(vec2 p) { return p / (length(p) * 0.85 + 0.15); }
`;

// Wind for leaves and the tops of plants.
const WAVE = `
uniform float uWaving;
uniform vec3 uCamWrap;
uniform float uTime;
vec3 wave(vec3 p, int flags) {
  if (uWaving <= 0.0) return p;
  vec3 w = p + uCamWrap;
  float t = uTime;
  if ((flags & FLAG_PLANT) != 0 && (flags & FLAG_TOP) != 0) {
    float a = sin(t * 1.9 + w.x * 0.55 + w.z * 0.35) + 0.4 * sin(t * 3.7 + w.z * 1.3 + w.x * 0.2);
    float b = sin(t * 1.5 + w.z * 0.6 + w.x * 0.25) + 0.4 * sin(t * 3.1 + w.x * 1.1);
    p.xz += vec2(a, b) * 0.05 * uWaving;
  } else if ((flags & FLAG_LEAVES) != 0) {
    p.x += sin(t * 1.7 + w.x * 0.9 + w.y * 0.6) * 0.022 * uWaving;
    p.y += sin(t * 2.1 + w.z * 0.8 + w.x * 0.5) * 0.016 * uWaving;
    p.z += sin(t * 1.4 + w.z * 1.1 + w.y * 0.4) * 0.022 * uWaving;
  }
  return p;
}
`;

// The sky's colour in a direction, without the sun, moon, stars or clouds.
// Terrain fog uses it too, so distant land melts into the sky behind it.
const SKY = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunset;
uniform float uSunsetAmt;
uniform float uNight;
uniform float uCloudCover;
vec3 skyGradient(vec3 dir) {
  float h = dir.y;
  float hp = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(hp, 0.45));
  // A paler band of haze right at the horizon.
  col = mix(col, min(uHorizon * 1.12, vec3(1.0)), exp(-hp * 9.0) * 0.45);
  float mu = dot(dir, uSunDir);
  float up = smoothstep(-0.35, 0.05, uSunDir.y);
  // Glow around the sun, wider and redder toward sunset.
  float glow = pow(max(mu, 0.0), 5.0) * 0.22 + pow(max(mu, 0.0), 32.0) * 0.3;
  vec3 glowCol = mix(vec3(1.0, 0.93, 0.8), uSunset, uSunsetAmt);
  col += glowCol * glow * up * (1.0 - uCloudCover * 0.75);
  // Sunset colours low in the sky, strongest on the sun's side.
  float band = exp(-abs(h) * 5.0) * (0.3 + 0.7 * pow(max(mu, 0.0) * 0.5 + 0.5, 3.0));
  col = mix(col, uSunset, clamp(band * uSunsetAmt * 0.8, 0.0, 1.0));
  if (h < 0.0) col = mix(col, uHorizon * 0.6, smoothstep(0.0, 0.6, -h));
  return col;
}
`;

const NOISE = `
float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i), b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0)), d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += vnoise(p) * a;
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

// Soft shadows from the sun's depth map, with an 8-tap Poisson filter.
const SHADOW = `
uniform highp sampler2DShadow uShadow;
uniform mat4 uShadowMat;
uniform float uShadowOn;
const vec2 POISSON[8] = vec2[8](
  vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.170), vec2(0.421, -0.684), vec2(-0.069, 0.364), vec2(0.871, -0.072)
);
float shadowAt(vec3 pos, vec3 n) {
  vec3 p = pos + n * (0.025 + length(pos) * 0.0025);
  vec4 s = uShadowMat * vec4(p, 1.0);
  float f = length(s.xy) * 0.85 + 0.15;
  vec3 c = vec3(s.xy / f, s.z) * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  c.z -= 0.00012;
  float r = 1.4 / ${SHADOW_SIZE.toFixed(1)};
  float sum = 0.0;
  for (int i = 0; i < 8; i++) sum += texture(uShadow, vec3(c.xy + POISSON[i] * r, c.z));
  return sum / 8.0;
}
`;

// Light shared by terrain and mobs: sun (or moon) with shadows, sky fill,
// torchlight and the dimension's ambient.
const LIGHTING = `
uniform vec3 uLightDir;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform vec3 uBlockLight;
uniform vec3 uAmbient;
vec3 lightAt(vec3 pos, vec3 n, float sky, float blk, float ao, float diffuse) {
  float open = smoothstep(0.45, 0.93, sky);
  float sh = 1.0;
  if (uShadowOn > 0.001 && diffuse > 0.0 && open > 0.0) sh = mix(1.0, shadowAt(pos, n), uShadowOn);
  vec3 sun = uSunLight * diffuse * sh * open;
  vec3 fill = uSkyLight * sky * sky * (0.72 + 0.28 * n.y);
  vec3 torch = uBlockLight * pow(blk, 3.0);
  return sun * mix(1.0, ao, 0.45) + (fill + torch + uAmbient) * ao;
}
`;

const FOG = `
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uSkyFog;
uniform float uHaze;
vec3 applyFog(vec3 color, vec3 pos, out float edge) {
  float dist = length(pos);
  vec3 dir = pos / max(dist, 0.0001);
  vec3 fogCol = uSkyFog > 0.5 ? toLinear(skyGradient(dir)) : toLinear(uFogColor);
  edge = smoothstep(uFog.x, uFog.y, dist);
  float haze = (1.0 - exp(-dist * uHaze)) * uSkyFog;
  return mix(color, fogCol, max(edge, haze));
}
`;

const head = (extra = '') => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
${extra}
${COMMON}`;

export const TERRAIN_VS = `${head()}
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aTex;
layout(location = 2) in vec4 aLight;
uniform mat4 uViewProj;
uniform vec3 uOffset;
${WAVE}
out vec3 vUV;
out vec2 vLight;
out float vAO;
out vec3 vPos;
flat out int vFlags;
const float AO[4] = float[4](0.38, 0.6, 0.8, 1.0);
void main() {
  int flags = int(aPos.w);
  vec3 p = wave(aPos.xyz / 16.0 + uOffset, flags);
  vec2 uv = aTex.xy / 16.0;
  if ((flags & FLAG_SCROLL) != 0) uv += vec2(uTime * 0.021, uTime * 0.034);
  vUV = vec3(uv, aTex.z + aTex.w * 256.0);
  vLight = aLight.xy / 240.0;
  vAO = AO[int(aLight.z)];
  vPos = p;
  vFlags = flags;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const TERRAIN_FS = `${head()}
uniform sampler2DArray uTex;
uniform int uTranslucent;
uniform float uUnderwater;
uniform float uTime;
uniform vec3 uCamWrap;
in vec3 vUV;
in vec2 vLight;
in float vAO;
in vec3 vPos;
flat in int vFlags;
out vec4 outColor;
${SKY}
${SHADOW}
${LIGHTING}
${FOG}
// Ripples: a few crossing wave trains; returns the slope of the surface.
vec2 ripple(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec4 W[4] = vec4[4](vec4(0.83, 0.56, 1.7, 1.3), vec4(-0.45, 0.89, 2.9, 1.9), vec4(0.2, -0.98, 4.3, 2.4), vec4(-0.94, -0.33, 6.1, 3.1));
  float amp = 0.045;
  for (int i = 0; i < 4; i++) {
    vec2 d = W[i].xy;
    float k = W[i].z;
    g += d * k * amp * cos(dot(d, p) * k + t * W[i].w);
    amp *= 0.62;
  }
  return g;
}
void main() {
  vec4 tex = texture(uTex, vUV);
  if (uTranslucent == 0 && tex.a < 0.5) discard;
  if (uTranslucent == 1 && tex.a < 0.02) discard;
  vec3 albedo = toLinear(tex.rgb);
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(n, vPos) > 0.0) n = -n;
  bool water = (vFlags & FLAG_WATER) != 0;
  bool plant = (vFlags & FLAG_PLANT) != 0;
  bool leaves = (vFlags & FLAG_LEAVES) != 0;
  float sky = vLight.x;
  float blk = vLight.y;
  float ndl = dot(n, uLightDir);
  // Leaves and plants let light through, so they are never fully dark on the shady side.
  float diffuse = plant ? 0.4 + 0.2 * abs(ndl) : leaves ? max(ndl, 0.0) * 0.55 + 0.22 : max(ndl, 0.0);
  vec3 color = albedo * lightAt(vPos, n, sky, blk, vAO, diffuse);
  // Glowing blocks: lava, glowstone, torches, fire, portals.
  if (blk > 0.995) color = albedo * 1.5;
  float alpha = tex.a;
  if (water) {
    vec3 wn = n;
    if (n.y > 0.5 && uUnderwater < 0.5) {
      vec2 g = ripple((vPos + uCamWrap).xz, uTime);
      wn = normalize(vec3(-g.x, 1.0, -g.y));
    }
    vec3 v = normalize(vPos);
    float cosT = clamp(dot(-v, wn), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    vec3 r = reflect(v, wn);
    r.y = abs(r.y);
    float open = smoothstep(0.45, 0.93, sky);
    vec3 refl = toLinear(skyGradient(r)) * open;
    float sh = uShadowOn > 0.001 ? mix(1.0, shadowAt(vPos, n), uShadowOn) : 1.0;
    float spec = pow(max(dot(r, uLightDir), 0.0), 400.0) * 20.0;
    if (uUnderwater > 0.5) fres = 0.0;
    color = mix(color * 0.8, refl, fres) + uSunLight * spec * sh * open;
    alpha = mix(min(tex.a + 0.08, 1.0), 1.0, fres);
  }
  float edge;
  color = applyFog(color, vPos, edge);
  outColor = vec4(color, uTranslucent == 1 ? mix(alpha, 1.0, edge) : 1.0);
}`;

// Depth-only pass from the sun for terrain (leaves and glass are cut out).
export const SHADOW_VS = `${head()}
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aTex;
uniform mat4 uShadowMat;
uniform vec3 uOffset;
${WAVE}
out vec3 vUV;
void main() {
  int flags = int(aPos.w);
  vec3 p = wave(aPos.xyz / 16.0 + uOffset, flags);
  vUV = vec3(aTex.xy / 16.0, aTex.z + aTex.w * 256.0);
  vec4 s = uShadowMat * vec4(p, 1.0);
  s.xy = distortShadow(s.xy);
  gl_Position = s;
}`;

export const SHADOW_FS = `${head()}
uniform sampler2DArray uTex;
in vec3 vUV;
void main() {
  if (texture(uTex, vUV).a < 0.5) discard;
}`;

// Mobs, in the shadow pass and lit like the terrain.
export const ENTITY_SHADOW_VS = `${head()}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uShadowMat;
uniform mat4 uModel;
out vec2 vUV;
void main() {
  vUV = aUV;
  vec4 s = uShadowMat * (uModel * vec4(aPos, 1.0));
  s.xy = distortShadow(s.xy);
  gl_Position = s;
}`;

export const ENTITY_SHADOW_FS = `${head()}
uniform sampler2DArray uSkins;
uniform float uLayer;
in vec2 vUV;
void main() {
  if (texture(uSkins, vec3(vUV, uLayer)).a < 0.5) discard;
}`;

export const ENTITY_FS = `${head()}
uniform sampler2DArray uSkins;
uniform float uLayer;
uniform vec2 uLevels;
uniform vec4 uOverlay;
uniform float uAlphaMode;
in vec2 vUV;
in float vShade;
in float vDist;
in vec3 vPos;
out vec4 outColor;
${SKY}
${SHADOW}
${LIGHTING}
${FOG}
void main() {
  vec4 tex = texture(uSkins, vec3(vUV, uLayer));
  if (uAlphaMode < 0.5 && tex.a < 0.5) discard;
  if (tex.a < 0.02) discard;
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(n, vPos) > 0.0) n = -n;
  vec3 albedo = toLinear(tex.rgb);
  vec3 color = albedo * lightAt(vPos, n, uLevels.x, uLevels.y, 0.85 + 0.15 * vShade, max(dot(n, uLightDir), 0.0));
  if (uLevels.y > 0.995) color = albedo * 1.1;
  color = mix(color, toLinear(uOverlay.rgb), uOverlay.a);
  float edge;
  color = applyFog(color, vPos, edge);
  outColor = vec4(color, uAlphaMode < 0.5 ? 1.0 : tex.a);
}`;

export const SKY_FS = `${head()}
in vec2 vNdc;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uTan;
uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uCloudColor;
uniform float uShowSun;
uniform float uCelestial;
uniform vec3 uSunLight;
out vec4 outColor;
${SKY}
${NOISE}
const float CLOUD_Y = 200.0;
void main() {
  vec3 dir = normalize(uForward + vNdc.x * uTan.x * uRight + vNdc.y * uTan.y * uUp);
  float h = dir.y;
  vec3 col = toLinear(skyGradient(dir));
  // Stars, twinkling.
  if (uNight > 0.01 && (h > 0.0 || uShowSun < 0.5)) {
    vec3 a = abs(dir);
    vec3 cube = dir / max(a.x, max(a.y, a.z));
    vec3 cell = floor(cube * 220.0);
    float s = hash3(cell);
    if (s > 0.9975) {
      float tw = 0.65 + 0.35 * sin(uTime * (2.0 + s * 900.0) + s * 6283.0);
      col += vec3(0.8, 0.85, 1.0) * uNight * uCelestial * tw * (uShowSun > 0.5 ? smoothstep(0.0, 0.25, h) : 0.5) * 0.5;
    }
  }
  if (uShowSun > 0.5) {
    float mu = dot(dir, uSunDir);
    // The sun: a bright disc with a soft corona that the bloom spreads.
    float disc = smoothstep(0.99935, 0.99962, mu);
    col += vec3(1.0, 0.9, 0.72) * disc * 18.0 * uCelestial;
    col += vec3(1.0, 0.75, 0.45) * pow(max(mu, 0.0), 1400.0) * 2.5 * uCelestial;
    // The moon, with dark seas, and a faint halo.
    float mm = dot(dir, -uSunDir);
    float moon = smoothstep(0.99955, 0.99975, mm);
    if (moon > 0.0) {
      vec3 r = normalize(cross(-uSunDir, vec3(0.0, 0.0, 1.0)));
      vec3 u = cross(r, -uSunDir);
      vec2 q = vec2(dot(dir, r), dot(dir, u)) / mm;
      float seas = smoothstep(0.45, 0.75, vnoise(q * 260.0)) * 0.3;
      col = mix(col, vec3(0.9, 0.92, 1.0) * (1.0 - seas) * 1.4, moon * uCelestial);
    }
    col += vec3(0.5, 0.6, 0.9) * pow(max(mm, 0.0), 300.0) * 0.12 * uCelestial;
    // Soft clouds on a layer high above, lit from the sun's side.
    bool below = uCamPos.y < CLOUD_Y;
    if ((below && h > 0.01) || (!below && h < -0.01)) {
      float t = (CLOUD_Y - uCamPos.y) / h;
      vec2 p = (uCamPos.xz + dir.xz * t) / 420.0 + vec2(uTime * 0.0035, uTime * 0.001);
      float cover = mix(0.56, 0.18, uCloudCover);
      float d = fbm(p);
      float density = smoothstep(cover, cover + 0.28, d);
      if (density > 0.0) {
        float d2 = fbm(p + uSunDir.xz * 0.06);
        float lit = 1.0 - smoothstep(cover - 0.05, cover + 0.45, d2) * 0.55;
        vec3 base = toLinear(uCloudColor);
        vec3 cloud = base * (0.55 + 0.6 * lit) + toLinear(uSunset) * uSunsetAmt * lit * 0.35;
        cloud += uSunLight * 0.2 * pow(max(mu, 0.0), 8.0) * lit;
        float fade = (1.0 - smoothstep(1500.0, 6000.0, t)) * smoothstep(0.0, 0.08, abs(h));
        col = mix(col, cloud, density * fade * 0.92);
      }
    }
  }
  outColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- post-processing

export const POST_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Bright parts of the image, at a quarter of the resolution.
export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y += 2) for (int x = -1; x <= 1; x += 2) c += texture(uColor, vUv + vec2(x, y) * uTexel).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(c * max(l - 0.85, 0.0) / max(l, 0.0001), 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDir;
in vec2 vUv;
out vec4 outColor;
const float W[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
  vec3 c = texture(uSrc, vUv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    c += texture(uSrc, vUv + uDir * float(i)).rgb * W[i];
    c += texture(uSrc, vUv - uDir * float(i)).rgb * W[i];
  }
  outColor = vec4(c, 1.0);
}`;

// God rays: march from each pixel toward the sun, counting open sky.
export const RAYS_FS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
uniform vec2 uSunUv;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 delta = (vUv - uSunUv) / 48.0;
  vec2 p = vUv;
  float decay = 1.0;
  float sum = 0.0;
  for (int i = 0; i < 48; i++) {
    p -= delta;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    sum += (texture(uDepth, p).r >= 0.99999 ? 1.0 : 0.0) * decay;
    decay *= 0.965;
  }
  outColor = vec4(vec3(sum / 48.0), 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform vec3 uRayColor;
uniform float uExposure;
uniform float uUnderwater;
uniform float uTime;
uniform vec4 uTint;
in vec2 vUv;
out vec4 outColor;
// ACES filmic curve (Narkowicz fit).
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.2), cos(uv.x * 20.0 + uTime * 1.8)) * 0.0025;
  vec3 c = texture(uColor, uv).rgb;
  c += texture(uBloom, uv).rgb * 0.6;
  c += uRayColor * texture(uRays, uv).r;
  c = aces(c * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  // A little extra saturation, and a soft vignette.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.06);
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.38;
  c = mix(c, uTint.rgb, uTint.a);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
