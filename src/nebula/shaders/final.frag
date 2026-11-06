uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExpand;
uniform float uEnergy;
uniform float uFade;
uniform vec2 uCore;

varying vec2 vUv;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  float aspect = uResolution.x / uResolution.y;

  // Very mild chromatic aberration toward the frame edges.
  float ca = (0.0006 + 0.0016 * (1.0 - uExpand)) * length(dir);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * ca * 1.6).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * ca * 1.6).b;

  // A soft lens haze around the collapsed core.
  vec2 p = dir * vec2(aspect, 1.0);
  float haze = exp(-length(p) * 7.0);
  float collapse = 1.0 - uExpand;
  col += vec3(0.62, 0.76, 1.0) * haze * 0.018;
  col += vec3(1.0, 0.82, 0.62) * exp(-length(p) * 16.0) * collapse * 0.05;

  // A crisp newborn star on the projected core, independent of cloud
  // resolution and following the hand parallax.
  vec2 toCore = p - uCore;
  float coreStar = exp(-length(toCore) * 320.0);
  float starHalo = exp(-length(toCore) * 30.0) * 0.08;
  col += vec3(1.0, 0.95, 0.88) * coreStar * (0.55 + 0.9 * collapse);
  col += vec3(0.95, 0.88, 1.0) * starHalo * (0.4 + 0.8 * collapse);

  col *= 0.94 + 0.18 * uEnergy;
  col = aces(col);

  // Vignette + gentle blue-in-the-shadows grade.
  float vig = smoothstep(1.55, 0.30, length((uv - 0.5) * vec2(1.28, 1.08)));
  col *= mix(0.42, 1.0, vig);
  col = mix(col, col * vec3(0.92, 0.97, 1.10), 0.32);

  // Film grain, slightly animated.
  float grain = hash(uv * uResolution + fract(uTime) * 317.0) - 0.5;
  col += grain * 0.016 * (1.0 - col * 0.6);

  col = toSRGB(col) * uFade;
  gl_FragColor = vec4(col, 1.0);
}
