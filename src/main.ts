import "./style.css";
import { generateNoiseVolume } from "./lib/noiseTexture";
import { NebulaScene } from "./nebula/NebulaScene";
import { HandTracker, CameraError } from "./hand/HandTracker";
import { GestureClassifier } from "./hand/gesture";
import { Hud } from "./ui/Hud";
import { AmbientAudio } from "./audio/Ambient";
import { OneEuroFilter, Spring, clamp, clamp01, damp } from "./lib/motion";

type Mode = "idle" | "gesture" | "demo";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const video = document.getElementById("video") as HTMLVideoElement;

const params = new URLSearchParams(window.location.search);
const autoDemo = params.get("mode") === "demo" || params.get("demo") === "1";
const fixedExpand = params.has("expand")
  ? clamp01(Number(params.get("expand")) || 0)
  : null;
const delegateParam = params.get("delegate") === "cpu" ? "CPU" : "GPU";
const qualityParam = params.has("quality")
  ? clamp(Number(params.get("quality")) || 0.5, 0.46, 0.86)
  : null;

let scene: NebulaScene | null = null;
let tracker: HandTracker | null = null;
let mode: Mode = "idle";
let starting = false;

const spring = new Spring(0.14, 40, 9.2);
const opennessFilter = new OneEuroFilter(1.6, 0.15);
const classifier = new GestureClassifier();
const audio = new AmbientAudio();

let expand = 0.14;
let energy = 0;
let pointerX = 0;
let pointerY = 0;
let roll = 0;
let mouseX = 0;
let mouseY = 0;
let wheelTarget: number | null = null;
let wheelAt = 0;
let elapsed = 0;
let lastTime = performance.now();
let lastAudioAt = 0;
let frameId = 0;
let resizeId = 0;
let noHandSince = 0;
let noHandHinted = false;

const hud = new Hud({
  onStart: () => {
    void startGesture();
  },
  onDemo: () => startDemo(),
  onToggleSound: () => {
    void toggleSound();
  },
});

async function toggleSound(): Promise<void> {
  if (!audio.isStarted) {
    await audio.start();
  }
  const muted = audio.toggleMute();
  hud.setMuted(muted);
}

function startDemo(): void {
  if (!scene) return;
  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hud.setCameraIdle();
  mode = "demo";
  hud.hideLanding();
  hud.setMode("demo");
  hud.resetNote();
  void audio.start();
}

async function startGesture(): Promise<void> {
  if (starting || !scene) return;
  if (mode === "gesture" && tracker?.active) return;

  starting = true;
  // Start the sound inside the click gesture (Safari requires it) — it fades
  // in while the camera permission prompt is open.
  void audio.start();
  hud.resetNote();
  hud.setBusy("正在请求摄像头权限…");

  const nextTracker = new HandTracker(video);
  tracker = nextTracker;

  try {
    await nextTracker.startCamera();
    hud.setCameraLive();
    hud.setBusy("正在载入手部识别模型…");

    await nextTracker.loadModel(delegateParam);
    nextTracker.start();

    hud.setTrackingReady();
    hud.hideLanding();
    mode = "gesture";
    hud.setMode("gesture");
    hud.resetNote();
    hud.toast("手势已连接 · 握拳坍缩，缓缓张掌扩散", 4800);
  } catch (error) {
    const message =
      error instanceof CameraError
        ? error.message
        : "摄像头或手部识别初始化失败，请刷新页面后重试。";
    console.error("[app] start failed", error);
    nextTracker.stop();
    tracker = null;
    hud.setCameraIdle();
    hud.setError(`${message} 也可以先进入自动演示。`);
    void audio.suspend();
  } finally {
    starting = false;
  }
}

function onResize(): void {
  cancelAnimationFrame(resizeId);
  resizeId = requestAnimationFrame(() => scene?.resize());
}

function frame(now: number): void {
  frameId = requestAnimationFrame(frame);
  if (!scene) return;

  const dt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;
  elapsed += dt;

  const hand = tracker?.active ? tracker.frame : null;
  const handPresent = mode === "gesture" && !!hand?.present;

  let targetExpand: number;
  if (mode === "gesture") {
    if (handPresent && hand) {
      targetExpand = opennessFilter.filter(hand.openness, now / 1000);
      noHandSince = 0;
      noHandHinted = false;
    } else {
      if (!noHandSince) noHandSince = now;
      targetExpand = 0.46 + Math.sin(elapsed * 0.5) * 0.05;
      if (now - noHandSince > 6500 && !noHandHinted) {
        noHandHinted = true;
        hud.toast("没看到手部 · 把手掌放到画面中央，距离约 40–70cm", 4800);
      }
    }
  } else if (mode === "demo") {
    if (fixedExpand !== null) {
      targetExpand = fixedExpand;
    } else if (wheelTarget !== null && now - wheelAt < 5000) {
      targetExpand = wheelTarget;
    } else {
      wheelTarget = null;
      targetExpand = 0.5 + Math.sin(elapsed * 0.42) * 0.33;
    }
  } else {
    targetExpand = 0.74 + Math.sin(elapsed * 0.32) * 0.05;
  }

  let targetPointerX = mouseX;
  let targetPointerY = mouseY;
  let targetRoll = 0;

  if (handPresent && hand) {
    targetPointerX = clamp((hand.palmX - 0.5) * 2.5, -1, 1);
    targetPointerY = clamp((hand.palmY - 0.5) * 2.5, -1, 1);
    targetRoll = hand.roll;
  }

  pointerX = damp(pointerX, targetPointerX, 4.2, dt);
  pointerY = damp(pointerY, targetPointerY, 4.2, dt);
  roll = damp(roll, targetRoll, 3, dt);

  expand = clamp01(spring.step(targetExpand, dt));
  const speed = Math.abs(spring.velocity);
  energy = damp(energy, clamp01(speed * 0.48 + (1 - expand) * 0.16), 5.5, dt);

  const kind = classifier.update(expand, handPresent);

  scene.update(dt, {
    expand,
    energy,
    roll: roll * 0.7,
    pointerX,
    pointerY,
  });
  scene.render();

  hud.update({
    expand,
    energy,
    fps: scene.fpsValue,
    quality: scene.qualityValue,
    present: handPresent,
    kind,
  });
  hud.drawPreview(hand?.landmarks ?? null, expand, handPresent);

  if (now - lastAudioAt > 90) {
    lastAudioAt = now;
    audio.update(expand, energy);
  }
}

function attachInput(): void {
  window.addEventListener("pointermove", (event) => {
    const nx = (event.clientX / window.innerWidth) * 2 - 1;
    const ny = (event.clientY / window.innerHeight) * 2 - 1;
    mouseX = clamp(nx, -1, 1) * 0.9;
    mouseY = clamp(-ny, -1, 1) * 0.9;
  });

  window.addEventListener(
    "wheel",
    (event) => {
      if (mode !== "demo") return;
      event.preventDefault();
      const base = wheelTarget ?? expand;
      wheelTarget = clamp01(base - event.deltaY * 0.0011);
      wheelAt = performance.now();
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "m" || event.key === "M") {
      void toggleSound();
    }
  });

  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void audio.suspend();
    } else {
      void audio.resume();
      lastTime = performance.now();
    }
  });
}

async function boot(): Promise<void> {
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) {
    hud.setError("当前浏览器没有 WebGL 2 支持，星云无法渲染。请使用最新版 Chrome / Safari。");
    return;
  }

  try {
    const noise = await generateNoiseVolume(64, (progress) => {
      hud.setBoot(progress * 0.96, progress > 0.92 ? "正在点亮恒星…" : "正在编织星云噪声…");
    });

    scene = new NebulaScene(canvas, noise);
    if (qualityParam !== null) scene.setQuality(qualityParam, true);
    if (fixedExpand !== null) {
      spring.value = fixedExpand;
      expand = fixedExpand;
      scene.snapIntro();
    }
    (window as unknown as { __nebulaState: () => unknown }).__nebulaState = () => ({
      mode,
      expand,
      energy,
      elapsed,
      fps: scene?.fpsValue ?? 0,
      quality: scene?.qualityValue ?? 0,
    });
    attachInput();
    document.body.classList.add("is-ready");
    hud.setBoot(1, "星云已就绪");
    hud.setReady();

    lastTime = performance.now();
    frameId = requestAnimationFrame(frame);

    if (autoDemo || fixedExpand !== null) {
      window.setTimeout(() => startDemo(), 700);
    }
  } catch (error) {
    console.error("[app] boot failed", error);
    hud.setError("星云初始化失败 · 请刷新页面，或换用支持 WebGL 2 的浏览器。");
  }
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(frameId);
  tracker?.stop();
  audio.suspend();
});

void boot();
