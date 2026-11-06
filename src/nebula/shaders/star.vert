attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;
uniform float uOpacity;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float twinkle = 0.55 + 0.45 * sin(uTime * (0.35 + aPhase * 1.8) + aPhase * 47.0);
  float size = aSize * uPixelRatio * (0.78 + 0.34 * twinkle);
  gl_PointSize = size * (95.0 / max(-mv.z, 1.0));
  gl_PointSize = clamp(gl_PointSize, 0.6, 22.0 * uPixelRatio);

  vColor = aColor;
  vTwinkle = twinkle;
}
