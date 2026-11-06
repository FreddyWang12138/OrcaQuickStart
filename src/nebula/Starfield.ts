import * as THREE from "three";
import starVert from "./shaders/star.vert?raw";
import starFrag from "./shaders/star.frag?raw";
import flareVert from "./shaders/flare.vert?raw";
import flareFrag from "./shaders/flare.frag?raw";

const PALETTE = ["#cfe0ff", "#ffffff", "#9fb6ff", "#ffe6c7", "#ffc7e0", "#b9e9ff"];

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function starColor(palette: string[], brightness: number): THREE.Color {
  const color = new THREE.Color(palette[(Math.random() * palette.length) | 0]);
  return color.multiplyScalar(brightness);
}

interface PointsLayer {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

function buildLayer(
  count: number,
  opts: {
    radius: [number, number];
    size: [number, number];
    brightness: [number, number];
    band?: boolean;
    hero?: boolean;
  },
): PointsLayer {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tilt = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(0.42, 0.2, -0.28),
  );

  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;

    if (opts.band) {
      const phi = Math.random() * Math.PI * 2;
      const lat = gaussian() * 0.09;
      const dir = new THREE.Vector3(
        Math.cos(phi) * Math.cos(lat),
        Math.sin(lat),
        Math.sin(phi) * Math.cos(lat),
      ).applyMatrix4(tilt);
      x = dir.x;
      y = dir.y;
      z = dir.z;
    } else {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      x = s * Math.cos(phi);
      y = u;
      z = s * Math.sin(phi);
    }

    // Only keep the half-space in front of the camera.
    z = -Math.abs(z) - 0.02;
    const len = Math.hypot(x, y, z);
    const r = opts.radius[0] + Math.pow(Math.random(), 0.7) * (opts.radius[1] - opts.radius[0]);
    positions[i * 3] = (x / len) * r;
    positions[i * 3 + 1] = (y / len) * r;
    positions[i * 3 + 2] = (z / len) * r;

    const color = starColor(PALETTE, rand(opts.brightness[0], opts.brightness[1]));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    const sizeBias = Math.pow(Math.random(), opts.hero ? 1 : 2.6);
    sizes[i] = opts.size[0] + sizeBias * (opts.size[1] - opts.size[0]);
    phases[i] = Math.random() * 10;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: opts.hero ? flareVert : starVert,
    fragmentShader: opts.hero ? flareFrag : starFrag,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
      uOpacity: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;

  return { points, material };
}

/**
 * Three layers of stars: a broad field, a faint galactic band and a handful of
 * bright "hero" stars with diffraction spikes.
 */
export class Starfield {
  readonly group = new THREE.Group();
  private layers: PointsLayer[] = [];

  constructor() {
    const mobile = window.innerWidth < 900;
    const field = buildLayer(mobile ? 2200 : 3800, {
      radius: [14, 80],
      size: [0.35, 1.65],
      brightness: [0.35, 0.95],
    });
    const band = buildLayer(mobile ? 900 : 1800, {
      radius: [20, 95],
      size: [0.28, 0.9],
      brightness: [0.16, 0.5],
      band: true,
    });
    const heroes = buildLayer(12, {
      radius: [26, 82],
      size: [16, 38],
      brightness: [1.0, 2.0],
      hero: true,
    });

    this.layers = [field, band, heroes];
    for (const layer of this.layers) {
      this.group.add(layer.points);
    }
  }

  update(time: number, energy: number): void {
    for (const layer of this.layers) {
      layer.material.uniforms.uTime.value = time;
      layer.material.uniforms.uOpacity.value = 0.82 + energy * 0.18;
    }
  }

  setPixelRatio(ratio: number): void {
    for (const layer of this.layers) {
      layer.material.uniforms.uPixelRatio.value = ratio;
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      layer.material.dispose();
    }
    this.group.clear();
  }
}
