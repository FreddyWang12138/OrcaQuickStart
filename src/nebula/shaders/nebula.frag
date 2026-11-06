precision highp float;
precision highp sampler3D;

uniform vec2 uResolution;
uniform float uTime;
uniform float uExpand;
uniform float uEnergy;
uniform float uRoll;
uniform vec2 uPointer;
uniform sampler3D uNoise;

varying vec2 vUv;
out vec4 fragColor;

#define STEPS 44

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;

  float expand = clamp(uExpand, 0.0, 1.0);
  float spread = 0.45 + 2.15 * pow(expand, 1.6);
  float camZ = 3.60 + 1.60 * pow(expand, 1.35);

  // A gentle dolly driven by the hand position in front of the camera.
  vec3 ro = vec3(uPointer.x * 0.62, uPointer.y * 0.46, camZ);
  vec3 target = vec3(uPointer.x * 0.10, uPointer.y * 0.07, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * 1.72 + right * uv.x + up * uv.y);

  float drift = uTime * 0.032;
  float ang = uTime * 0.021 + uRoll * 0.55;

  // Hot compact core when collapsed, cold and vast when open.
  vec3 cCore = mix(vec3(1.0, 0.84, 0.56) * 2.0, vec3(0.76, 0.96, 1.0) * 1.55, expand);
  vec3 cMid = mix(vec3(1.0, 0.12, 0.42) * 1.45, vec3(0.28, 0.52, 1.0) * 1.15, expand);
  vec3 cOuter = mix(vec3(0.24, 0.02, 0.40) * 1.05, vec3(0.03, 0.09, 0.44) * 0.95, expand);
  vec3 cAccent = mix(vec3(1.0, 0.38, 0.66), vec3(0.26, 0.96, 0.92), smoothstep(0.15, 0.82, expand));

  // March only the slab that can contain the cloud.
  float tStart = max(0.2, camZ - spread * 1.55);
  float tEnd = camZ + spread * 1.55;
  float dt = (tEnd - tStart) / float(STEPS);
  float t = tStart + dt * hash12(gl_FragCoord.xy + fract(uTime));
  vec3 acc = vec3(0.0);
  float trans = 1.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    vec3 q = p;
    q.xz = rot(ang) * q.xz;
    q.xy = rot(-0.30) * q.xy;
    q /= spread;
    q.z *= 1.15;
    float r = length(q);

    if (r < 1.5) {
      // One low-frequency fetch provides the domain warp vector.
      vec4 warpN = texture(uNoise, q * 0.19 + vec3(0.0, drift * 0.4, 0.0));
      vec3 warp = warpN.rgb * 2.0 - 1.0;
      vec3 wq = q + warp * mix(0.48, 0.66, expand);

      vec4 baseN = texture(uNoise, wq * 0.40 + vec3(0.04, 0.12, drift * 0.6));
      vec4 filN = texture(uNoise, wq * 0.95 + vec3(0.31, 0.47, drift * 1.4));
      vec4 fineN = texture(uNoise, wq * 2.10 + vec3(0.61, 0.29, drift * 1.9));

      float body = baseN.r;
      float macro = baseN.a;
      float fil = filN.g;
      float dust = filN.r;
      float fine = fineN.b;

      float structure = body * 0.56 + macro * 0.24 + fine * 0.20;
      float envelope = exp(-r * r * 2.2) * smoothstep(1.3, 0.28, r);
      float ridge = smoothstep(0.55, 0.85, fil);
      float dustMask = smoothstep(0.50, 0.78, dust);

      float threshold = mix(0.455, 0.405, expand);
      float density = smoothstep(threshold, threshold + 0.185, structure * (0.82 + 0.30 * macro));
      density *= envelope;
      density *= mix(0.5, 1.0, ridge);
      density *= 1.0 - dustMask * 0.72;
      density *= mix(1.1, 0.78, expand);
      density += ridge * envelope * 0.16;

      // When the cloud opens up, a cavity is carved around the centre. It reads
      // as gas being pushed outward and leaves the newborn star exposed.
      float cavity = smoothstep(0.02, 0.16 + 0.26 * expand, r);
      density *= mix(1.0, cavity, expand * 0.9);

      // Small, violent core that survives the collapse.
      float core = exp(-r * r * 70.0);
      density += core * mix(2.6, 0.18, expand);

      // A thin accretion ring appears while the nebula is compressed.
      float cyl = length(q.xz);
      float ring = exp(-pow((cyl - 0.50) / 0.105, 2.0)) * exp(-pow(q.y / 0.085, 2.0));
      ring *= pow(smoothstep(0.42, 0.85, 1.0 - expand), 2.0) * (0.55 + 0.45 * ridge);
      density += ring * 2.0;

      density = max(density, 0.0);

      float coreMix = smoothstep(0.28, 0.02, r);
      vec3 col = mix(cOuter, cMid, smoothstep(0.95, 0.12, r));
      col = mix(col, cCore, coreMix * coreMix);
      col = mix(col, cAccent, pow(ridge, 2.0) * 0.42 * (1.0 - coreMix));
      col = mix(col, vec3(0.62, 0.24, 0.95), smoothstep(0.62, 0.92, macro) * 0.22);
      vec3 cRose = mix(vec3(1.0, 0.34, 0.52), vec3(0.82, 0.40, 0.98), expand);
      col = mix(col, cRose, smoothstep(0.38, 0.06, r) * 0.26 * (1.0 - coreMix));
      col *= 0.84 + 0.32 * macro;
      col += vec3(1.0, 0.82, 0.55) * ring * 1.1;

      float emit = density * (0.72 + 0.55 * ridge);
      acc += col * emit * dt * trans * mix(1.7, 1.38, expand);
      trans *= exp(-density * 0.38 * dt);
    }

    t += dt;
    if (trans < 0.02) break;
  }

  // Tight screen-space corona so the core reads as a star. The centre is the
  // projected world origin, which drifts with the hand parallax.
  vec3 coreDir = normalize(-ro);
  float coreDenom = max(dot(coreDir, fwd), 0.2);
  vec2 coreUV = vec2(dot(coreDir, right), dot(coreDir, up)) / coreDenom * 1.72;
  float rr = dot(uv - coreUV, uv - coreUV);
  float halo = exp(-rr * 180.0) * 0.16 + exp(-sqrt(rr) * 9.0) * 0.01;
  acc += cCore * halo * (0.22 + 1.25 * (1.0 - expand) * (1.0 - expand));

  // Deep space backdrop.
  vec3 bg = vec3(0.0035, 0.0028, 0.010);
  bg += vec3(0.014, 0.008, 0.032) * exp(-sqrt(rr) * 1.6) * 0.45;
  acc += bg;

  fragColor = vec4(acc, 1.0);
}
