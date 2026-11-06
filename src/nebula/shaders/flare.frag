uniform float uOpacity;

varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float glow = exp(-d * 11.0) * 0.9;
  float core = smoothstep(0.5, 0.0, d * 3.2);
  float rayX = exp(-abs(c.y) * 190.0) * exp(-abs(c.x) * 5.0);
  float rayY = exp(-abs(c.x) * 190.0) * exp(-abs(c.y) * 5.0);
  float rays = (rayX + rayY) * 0.55;

  vec3 col = vColor * (glow + core * 1.4 + rays) * vTwinkle * uOpacity;
  gl_FragColor = vec4(col, 1.0);
}
