uniform float uOpacity;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float core = smoothstep(0.5, 0.0, d);
  float glow = pow(max(0.0, 1.0 - d * 2.0), 3.0);
  vec3 col = vColor * (core * core * 1.35 + glow * 0.32) * vTwinkle * uOpacity;

  gl_FragColor = vec4(col, 1.0);
}
