import "./style.css";
import "./game/game.css";
import { generateNoiseVolume } from "./lib/noiseTexture";
import { NebulaScene } from "./nebula/NebulaScene";
import { HandTracker, CameraError } from "./hand/HandTracker";
import { GestureClassifier } from "./hand/gesture";
import { Hud } from "./ui/Hud";
import { AmbientAudio } from "./audio/Ambient";
import { OneEuroFilter, Spring, clamp, clamp01, damp } from "./lib/motion";
import { Game, type GameEvent } from "./game/Game";
import { GameRenderer } from "./game/GameRenderer";
import { GameUI } from "./game/GameUI";
import { Calibration, DEFAULT_THRESHOLDS, type GestureThresholds } from "./game/Calibration";

type Mode = "idle" | "gesture" | "demo" | "game";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const video = document.getElementById("video") as HTMLVideoElement;
const gameCanvas = document.getElementById("game-canvas") as HTMLCanvasElement;

const params = new URLSearchParams(window.location.search);
const autoDemo = params.get("mode") === "demo" || params.get("demo") === "1";
const autoMouseGame = params.get("mode") === "game" || params.get("game") === "1";
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
let gameMouseMode = false;
let calibrating = false;
let hasCalibrated = false;
let countdownToken = 0;
let gameOutro = 0;
let resultsShown = false;
let clenched = false;
let mouseHeld = false;
let spaceHeld = false;
let thresholds: GestureThresholds = { ...DEFAULT_THRESHOLDS };
let supernovaGlow = 0;

const spring = new Spring(0.14, 40, 9.2);
const opennessFilter = new OneEuroFilter(1.6, 0.15);
const gameFilter = new OneEuroFilter(2.8, 0.35);
const classifier = new GestureClassifier();
const audio = new AmbientAudio();
const game = new Game();
const gameRenderer = new GameRenderer(gameCanvas);
const calibration = new Calibration();

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

function loadBest(): number {
  try {
    return Number(localStorage.getItem("nebula-best") || 0) || 0;
  } catch {
    return 0;
  }
}

let bestScore = loadBest();

function saveBest(value: number): void {
  try {
    localStorage.setItem("nebula-best", String(Math.round(value)));
  } catch {
    /* storage may be unavailable */
  }
}

const hud = new Hud({
  onStart: () => {
    void startGame();
  },
  onFree: () => {
    void startFree();
  },
  onDemo: () => startDemo(),
  onMouseGame: () => startMouseGame(),
  onToggleSound: () => {
    void toggleSound();
  },
});

const gameUI = new GameUI({
  onSkipCalibration: () => skipCalibration(),
  onMouseGame: () => switchToMouseGame(),
  onReplay: () => startRound(),
  onExit: () => exitGame(),
});

async function toggleSound(): Promise<void> {
  if (!audio.isStarted) {
    await audio.start();
  }
  const muted = audio.toggleMute();
  hud.setMuted(muted);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureTracker(): Promise<boolean> {
  if (tracker?.active) {
    tracker.setPaused(false);
    return true;
  }
  if (starting) return false;

  starting = true;
  hud.setBusy("正在请求摄像头权限…");
  const next = new HandTracker(video);
  tracker = next;

  try {
    await next.startCamera();
    hud.setCameraLive();
    hud.setBusy("正在载入手部识别模型…");
    await next.loadModel(delegateParam);
    next.start();
    hud.setTrackingReady();
    return true;
  } catch (error) {
    const message =
      error instanceof CameraError
        ? error.message
        : "摄像头或手部识别初始化失败，请刷新页面后重试。";
    console.error("[app] start failed", error);
    next.stop();
    tracker = null;
    hud.setCameraIdle();
    hud.setError(`${message} 也可以先用鼠标试玩。`);
    void audio.suspend();
    return false;
  } finally {
    starting = false;
  }
}

async function startFree(): Promise<void> {
  if (starting || !scene || mode !== "idle") return;
  void audio.start();
  const ready = await ensureTracker();
  if (!ready) return;

  tracker?.setPaused(false);
  mode = "gesture";
  hud.hideLanding();
  hud.setMode("gesture");
  hud.resetNote();
  hud.toast("自由探索 · 握拳收缩，张掌扩散", 4200);
}

async function startGame(): Promise<void> {
  if (starting || !scene || mode !== "idle") return;
  void audio.start();
  const ready = await ensureTracker();
  if (!ready) return;

  tracker?.setPaused(false);
  beginGameSession(false);
}

function startMouseGame(): void {
  if (starting || !scene) return;
  if (mode === "game") {
    switchToMouseGame();
    return;
  }
  if (mode !== "idle") return;

  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hud.setCameraIdle();
  void audio.start();
  beginGameSession(true);
}

function beginGameSession(mouse: boolean): void {
  mode = "game";
  gameMouseMode = mouse;
  calibrating = !mouse && !hasCalibrated;
  document.body.classList.toggle("is-calibrating", calibrating);
  gameOutro = 0;
  resultsShown = false;
  clenched = false;
  mouseHeld = false;
  spaceHeld = false;

  hud.hideLanding();
  gameUI.enterGame();
  gameUI.setMouseMode(mouse);
  gameUI.hideResults();
  gameUI.showPause(false);
  gameRenderer.resize();
  game.setAspect(gameRenderer.aspect);
  game.prepare(bestScore);
  void audio.start();

  if (mouse) {
    hud.setCameraIdle();
    gameUI.hideCalibration();
    startRound();
    return;
  }

  if (!calibrating) {
    gameUI.hideCalibration();
    startRound();
    return;
  }

  calibration.reset();
  gameUI.showCalibration(calibration);
}

function switchToMouseGame(): void {
  if (mode !== "game") return;
  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hud.setCameraIdle();
  gameMouseMode = true;
  gameUI.setMouseMode(true);
  calibrating = false;
  document.body.classList.remove("is-calibrating");
  thresholds = calibration.skip();
  gameUI.hideCalibration();
  startRound();
}

function skipCalibration(): void {
  if (!calibrating || mode !== "game") return;
  calibrating = false;
  hasCalibrated = true;
  document.body.classList.remove("is-calibrating");
  thresholds = calibration.step === 0 ? calibration.skip() : calibration.thresholds;
  gameUI.hideCalibration();
  startRound();
}

function startRound(): void {
  if (mode !== "game") return;
  document.body.classList.remove("is-calibrating");
  gameUI.hideResults();
  gameUI.showPause(false);
  gameUI.hideCalibration();
  gameUI.clearBanner();
  game.prepare(bestScore);
  gameOutro = 0;
  resultsShown = false;
  clenched = false;
  void runCountdown();
}

async function runCountdown(): Promise<void> {
  const token = ++countdownToken;
  const sub = gameMouseMode
    ? "按住吸星尘 · 松开放冲击波"
    : "握拳吸星尘 · 张掌放冲击波";

  for (const label of ["3", "2", "1"]) {
    if (token !== countdownToken || mode !== "game") return;
    gameUI.showCountdown(label, sub);
    audio.tick();
    await sleep(620);
  }

  if (token !== countdownToken || mode !== "game") return;
  gameUI.showCountdown("GO", sub);
  audio.tick(true);
  game.begin();
  await sleep(520);
  if (token === countdownToken) gameUI.hideCountdown();
}

function exitGame(): void {
  if (mode !== "game") return;
  countdownToken++;
  gameUI.exitGame();
  gameRenderer.clear();
  game.prepare(bestScore);
  calibrating = false;
  document.body.classList.remove("is-calibrating");
  gameMouseMode = false;
  gameOutro = 0;
  resultsShown = false;
  clenched = false;
  mouseHeld = false;
  spaceHeld = false;
  mode = "idle";

  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hud.setCameraIdle();
  void audio.suspend();
  hud.resetNote();
  hud.setMuted(audio.isMuted);
  hud.showLanding();
}

function startDemo(): void {
  if (!scene) return;
  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hud.setCameraIdle();
  hud.setMuted(audio.isMuted);
  mode = "demo";
  hud.hideLanding();
  hud.setMode("demo");
  hud.resetNote();
  void audio.start();
}

function handleGameEvent(event: GameEvent): void {
  switch (event.type) {
    case "absorb":
      audio.absorb(event.value);
      break;
    case "shatter":
      audio.shatter(event.power, event.perfect);
      break;
    case "damage":
      audio.damage();
      break;
    case "shockwave":
      audio.shock(event.power);
      break;
    case "wave":
      gameUI.showBanner(`WAVE ${String(event.wave).padStart(2, "0")}`);
      audio.wave();
      break;
    case "supernova":
      audio.supernova();
      break;
    case "pause":
      gameUI.showPause(true);
      break;
    case "resume":
      gameUI.showPause(false);
      break;
    case "gameover":
      gameUI.showPause(false);
      gameOutro = 1.3;
      if (game.results) {
        bestScore = Math.max(bestScore, game.results.best);
        saveBest(bestScore);
      }
      audio.gameOver(event.victory);
      break;
  }
}

function onResize(): void {
  cancelAnimationFrame(resizeId);
  resizeId = requestAnimationFrame(() => {
    scene?.resize();
    gameRenderer.resize();
    game.setAspect(gameRenderer.aspect);
  });
}

function frame(now: number): void {
  frameId = requestAnimationFrame(frame);
  if (!scene) return;

  const dt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;
  elapsed += dt;

  const hand = tracker?.active ? tracker.frame : null;
  const handPresent = (mode === "gesture" || mode === "game") && !!hand?.present;
  const rawGameOpen =
    handPresent && hand ? gameFilter.filter(hand.openness, now / 1000) : 0.5;

  let gameClenched = false;
  if (mode === "game") {
    if (gameMouseMode) {
      gameClenched = mouseHeld || spaceHeld;
    } else if (handPresent && hand) {
      if (clenched && rawGameOpen > thresholds.release) clenched = false;
      else if (!clenched && rawGameOpen < thresholds.fist) clenched = true;
      gameClenched = clenched;
    } else {
      clenched = false;
    }

    if (calibrating) {
      const done = calibration.update(dt, rawGameOpen, handPresent);
      if (done) {
        calibrating = false;
        hasCalibrated = true;
        document.body.classList.remove("is-calibrating");
        thresholds = calibration.thresholds;
        gameUI.hideCalibration();
        startRound();
      } else {
        gameUI.updateCalibration(calibration, handPresent);
      }
    }

    game.update(dt, {
      clenched: gameClenched,
      present: gameMouseMode ? true : handPresent,
    });
    for (const event of game.drainEvents()) handleGameEvent(event);

    if (gameOutro > 0) {
      gameOutro -= dt;
      if (gameOutro <= 0 && game.results && !resultsShown) {
        gameUI.showResults(game.results);
        resultsShown = true;
      }
    }

    gameUI.update(game, gameClenched);
    gameRenderer.draw(game, gameClenched && game.phase === "playing");
  }

  let targetExpand: number;
  if (mode === "game") {
    if (calibrating) {
      targetExpand = handPresent ? rawGameOpen : 0.5;
    } else if (game.phase === "playing") {
      targetExpand = gameClenched ? 0.28 - game.pressure * 0.22 : 0.92;
    } else if (game.phase === "paused") {
      targetExpand = 0.55;
    } else if (game.phase === "over") {
      targetExpand = 0.66;
    } else {
      targetExpand = gameClenched ? 0.24 : 0.86;
    }
  } else if (mode === "gesture") {
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

  const novaTarget = mode === "game" && game.supernova > 0 ? 1 : 0;
  supernovaGlow = damp(supernovaGlow, novaTarget, 2.2, dt);

  const kind = classifier.update(expand, handPresent);

  scene.update(dt, {
    expand,
    energy,
    roll: roll * 0.7,
    pointerX,
    pointerY,
    supernova: supernovaGlow,
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

  const isGameplayTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return !el?.closest("button, .game-panel");
  };

  window.addEventListener("pointerdown", (event) => {
    if (mode !== "game" || !gameMouseMode || game.phase !== "playing") return;
    if (!isGameplayTarget(event.target)) return;
    event.preventDefault();
    mouseHeld = true;
  });
  window.addEventListener("pointerup", () => {
    mouseHeld = false;
  });
  window.addEventListener("pointercancel", () => {
    mouseHeld = false;
  });
  window.addEventListener("blur", () => {
    mouseHeld = false;
    spaceHeld = false;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "m" || event.key === "M") {
      void toggleSound();
    }
    if (
      event.code === "Space" &&
      mode === "game" &&
      gameMouseMode &&
      game.phase === "playing"
    ) {
      event.preventDefault();
      spaceHeld = true;
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
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
    gameRenderer.resize();
    game.setAspect(gameRenderer.aspect);

    (window as unknown as { __nebulaState: () => unknown }).__nebulaState = () => ({
      mode,
      phase: game.phase,
      score: game.score,
      lives: game.lives,
      wave: game.wave,
      pressure: game.pressure,
      mass: game.mass,
      entities: game.entities.map((entity) => entity.kind),
      shockwaves: game.shockwaves.length,
      absorbed: game.stats.absorbed,
      destroyed: game.stats.destroyed,
      expand,
      energy,
      elapsed,
      fps: scene?.fpsValue ?? 0,
      quality: scene?.qualityValue ?? 0,
    });
    (window as unknown as { __nebulaGame: Game }).__nebulaGame = game;

    attachInput();
    document.body.classList.add("is-ready");
    hud.setBoot(1, "星云已就绪");
    hud.setReady();

    lastTime = performance.now();
    frameId = requestAnimationFrame(frame);

    if (autoDemo || fixedExpand !== null) {
      window.setTimeout(() => startDemo(), 700);
    } else if (autoMouseGame) {
      window.setTimeout(() => startMouseGame(), 700);
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
