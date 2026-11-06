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

  float twinkle = 0.6 + 0.4 * sin(uTime * (0.2 + aPhase) + aPhase * 23.0);
  gl_PointSize = aSize * uPixelRatio * (0.86 + 0.2 * twinkle);

  vColor = aColor;
  vTwinkle = twinkle;
}
