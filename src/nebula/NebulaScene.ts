import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import quadVert from "./shaders/quad.vert?raw";
import nebulaFrag from "./shaders/nebula.frag?raw";
import finalFrag from "./shaders/final.frag?raw";
import { Starfield } from "./Starfield";
import type { NoiseVolume } from "../lib/noiseTexture";

export interface NebulaFrame {
  expand: number;
  energy: number;
  roll: number;
  pointerX: number;
  pointerY: number;
}

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
    vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
    vec3 east = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
    vec3 west = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
    vec3 blur = (north + south + east + west) * 0.25;
    color += (color - blur) * 0.32;
    gl_FragColor = vec4(max(color, 0.0), 1.0);
  }
`;

const MIN_QUALITY = 0.46;
const MAX_PIXEL_RATIO = 1.25;
const MAX_QUALITY = 0.86;

export class NebulaScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly starfield: Starfield;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly finalPass: ShaderPass;
  private readonly starScene = new THREE.Scene();
  private readonly starCamera: THREE.PerspectiveCamera;
  private readonly starPass: RenderPass;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly rawScene = new THREE.Scene();
  private readonly rawCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly nebulaTarget: THREE.WebGLRenderTarget;
  private readonly nebulaMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private time = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private quality = 0.62;
  private fps = 60;
  private frames = 0;
  private fpsTime = 0;
  private statsAt = performance.now();
  private warmup = 3.5;
  private adaptCooldown = 2.5;
  private qualityLocked = false;
  private fade = 0;
  private disposed = false;
  private readonly camPos = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly coreDir = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, noise: NoiseVolume) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x030208, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    const mobile = window.innerWidth < 900;
    this.quality = mobile ? 0.5 : 0.62;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.pixelRatio);

    // ---- nebula volume -----------------------------------------------------
    const texture = new THREE.Data3DTexture(noise.data, noise.size, noise.size, noise.size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    this.nebulaTarget = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.nebulaTarget.texture.colorSpace = THREE.NoColorSpace;

    this.nebulaMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVert,
      fragmentShader: nebulaFrag,
      uniforms: {
        uResolution: { value: new THREE.Vector2(2, 2) },
        uTime: { value: 0 },
        uExpand: { value: 0.2 },
        uEnergy: { value: 0 },
        uRoll: { value: 0 },
        uPointer: { value: new THREE.Vector2() },
        uNoise: { value: texture },
      },
      depthTest: false,
      depthWrite: false,
    });

    const rawQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.nebulaMaterial);
    rawQuad.frustumCulled = false;
    this.rawScene.add(rawQuad);
    this.rawCamera.position.z = 1;

    const compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: this.nebulaTarget.texture },
        uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = compositeMaterial;
    const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
    compositeQuad.frustumCulled = false;
    this.quadScene.add(compositeQuad);
    this.quadCamera.position.z = 1;

    // ---- stars -------------------------------------------------------------
    this.starfield = new Starfield();
    this.starfield.setPixelRatio(this.pixelRatio);
    this.starCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    this.starScene.add(this.starfield.group);

    // ---- post --------------------------------------------------------------
    const quadPass = new RenderPass(this.quadScene, this.quadCamera);
    quadPass.clear = true;
    this.starPass = new RenderPass(this.starScene, this.starCamera);
    this.starPass.clear = false;

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 0.62);
    this.finalPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uExpand: { value: 0.5 },
        uEnergy: { value: 0 },
        uFade: { value: 0 },
        uCore: { value: new THREE.Vector2() },
      },
      vertexShader: quadVert,
      fragmentShader: finalFrag,
    });
    this.finalPass.renderToScreen = true;

    this.composer.addPass(quadPass);
    this.composer.addPass(this.starPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.finalPass);

    this.canvas.addEventListener("webglcontextlost", this.onContextLost);

    this.resize();
  }

  get fpsValue(): number {
    return this.fps;
  }

  get qualityValue(): number {
    return this.quality;
  }

  snapIntro(): void {
    this.fade = 1;
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.width = width;
    this.height = height;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);

    const rtWidth = Math.max(64, Math.round(width * this.quality));
    const rtHeight = Math.max(64, Math.round(height * this.quality));
    this.nebulaTarget.setSize(rtWidth, rtHeight);
    this.nebulaMaterial.uniforms.uResolution.value.set(rtWidth, rtHeight);
    this.compositeMaterial.uniforms.uTexel.value.set(1 / rtWidth, 1 / rtHeight);

    this.starCamera.aspect = width / height;
    this.starCamera.updateProjectionMatrix();
    this.starfield.setPixelRatio(this.pixelRatio);

    this.finalPass.uniforms.uResolution.value.set(width * this.pixelRatio, height * this.pixelRatio);
  }

  setQuality(quality: number, lock = false): void {
    if (this.disposed) return;
    this.quality = THREE.MathUtils.clamp(quality, MIN_QUALITY, MAX_QUALITY);
    this.qualityLocked = this.qualityLocked || lock;
    const rtWidth = Math.max(64, Math.round(this.width * this.quality));
    const rtHeight = Math.max(64, Math.round(this.height * this.quality));
    this.nebulaTarget.setSize(rtWidth, rtHeight);
    this.nebulaMaterial.uniforms.uResolution.value.set(rtWidth, rtHeight);
    this.compositeMaterial.uniforms.uTexel.value.set(1 / rtWidth, 1 / rtHeight);
  }

  update(dt: number, frame: NebulaFrame): void {
    this.time += dt;
    this.fade = Math.min(1, this.fade + dt * 0.7);

    const mat = this.nebulaMaterial.uniforms;
    mat.uTime.value = this.time;
    mat.uExpand.value = frame.expand;
    mat.uEnergy.value = frame.energy;
    mat.uRoll.value = frame.roll;
    mat.uPointer.value.set(frame.pointerX, frame.pointerY);

    this.starCamera.position.set(frame.pointerX * 1.5, frame.pointerY * 1.1, 0);
    this.starCamera.lookAt(frame.pointerX * 0.8, frame.pointerY * 0.5, -40);
    this.starfield.update(this.time, frame.energy);
    this.starfield.group.rotation.y += dt * (0.006 + frame.energy * 0.03);
    this.starfield.group.rotation.x = 0.12 + Math.sin(this.time * 0.03) * 0.025;
    // Expansion pushes the whole sky away; collapse pulls it back in.
    this.starfield.group.scale.setScalar(1.0 + frame.expand * 0.07);

    this.bloom.strength = 0.4 + frame.energy * 0.3 + (1 - frame.expand) * 0.4;
    this.bloom.radius = 0.5 + (1 - frame.expand) * 0.16;

    // Keep the screen-space core star glued to the nebula's projected centre.
    const camZ = 3.6 + 1.6 * Math.pow(frame.expand, 1.35);
    this.camPos.set(frame.pointerX * 0.62, frame.pointerY * 0.46, camZ);
    this.camTarget.set(frame.pointerX * 0.10, frame.pointerY * 0.07, 0);
    this.camFwd.copy(this.camTarget).sub(this.camPos).normalize();
    this.camRight.crossVectors(this.camFwd, THREE.Object3D.DEFAULT_UP).normalize();
    this.camUp.crossVectors(this.camRight, this.camFwd);
    this.coreDir.copy(this.camPos).negate().normalize();
    const denom = Math.max(this.coreDir.dot(this.camFwd), 0.2);
    const coreX = (1.72 * this.coreDir.dot(this.camRight)) / denom;
    const coreY = (1.72 * this.coreDir.dot(this.camUp)) / denom;

    const final = this.finalPass.uniforms;
    final.uTime.value = this.time;
    final.uExpand.value = frame.expand;
    final.uEnergy.value = frame.energy;
    final.uFade.value = this.fade;
    final.uCore.value.set(coreX * 0.5, coreY * 0.5);

    this.updateStats();
  }

  private updateStats(): void {
    const now = performance.now();
    const wall = (now - this.statsAt) / 1000;
    this.statsAt = now;
    this.frames++;
    this.fpsTime += wall;

    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }

    if (this.warmup > 0) {
      this.warmup -= wall;
      return;
    }
    this.adaptCooldown -= wall;
    if (this.adaptCooldown > 0 || this.qualityLocked) return;

    if (this.fps < 40 && this.quality > MIN_QUALITY) {
      this.setQuality(this.quality - 0.08);
      this.adaptCooldown = 2;
    } else if (this.fps > 52 && this.quality < MAX_QUALITY) {
      this.setQuality(this.quality + 0.04);
      this.adaptCooldown = 4;
    }
  }

  render(): void {
    if (this.disposed) return;

    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.nebulaTarget);
    this.renderer.clear();
    this.renderer.render(this.rawScene, this.rawCamera);
    this.renderer.setRenderTarget(previous);

    this.composer.render();
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    console.warn("[nebula] WebGL context lost");
  };

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.composer.dispose();
    this.nebulaTarget.dispose();
    this.nebulaMaterial.uniforms.uNoise.value.dispose();
    this.nebulaMaterial.dispose();
    this.quadScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.rawScene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.starfield.dispose();
    this.renderer.dispose();
  }
}
