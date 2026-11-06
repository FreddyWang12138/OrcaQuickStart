import type { GestureKind, Landmark } from "../hand/gesture";
import { CameraPreview } from "./CameraPreview";

export interface HudState {
  expand: number;
  energy: number;
  fps: number;
  quality: number;
  present: boolean;
  kind: GestureKind;
}

export interface HudCallbacks {
  onStart: () => void;
  onDemo: () => void;
  onToggleSound: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

export class Hud {
  private readonly landing = $("landing");
  private readonly startBtn = $<HTMLButtonElement>("btn-start");
  private readonly demoBtn = $<HTMLButtonElement>("btn-demo");
  private readonly soundBtn = $<HTMLButtonElement>("btn-sound");
  private readonly fullBtn = $<HTMLButtonElement>("btn-full");
  private readonly note = $("note");
  private readonly boot = $("boot");
  private readonly bootLabel = $("boot-label");
  private readonly bootPct = $("boot-pct");
  private readonly bootFill = $("boot-fill");
  private readonly energy = $("energy");
  private readonly energyValue = $("energy-value");
  private readonly fps = $("fps");
  private readonly statusPill = $("status-pill");
  private readonly statusText = $("status-text");
  private readonly statusSub = $("status-sub");
  private readonly cam = $("cam");
  private readonly hint = $("hint");
  private readonly toastEl = $("toast");
  private readonly preview: CameraPreview;

  private cameraLive = false;
  private trackingReady = false;
  private mode: "idle" | "gesture" | "demo" = "idle";
  private defaultNote = "需要摄像头权限 · 画面仅在本地设备处理，不会上传";
  private toastTimer = 0;
  private lastStatusText = "";
  private lastStatusSub = "";
  private lastEnergy = -1;
  private lastFps = -1;

  constructor(private readonly callbacks: HudCallbacks) {
    this.preview = new CameraPreview($<HTMLCanvasElement>("cam-overlay"));
    this.startBtn.addEventListener("click", () => this.callbacks.onStart());
    this.demoBtn.addEventListener("click", () => this.callbacks.onDemo());
    this.soundBtn.addEventListener("click", () => this.callbacks.onToggleSound());
    this.fullBtn.addEventListener("click", () => {
      void this.toggleFullscreen();
    });
    this.cam.classList.add("is-empty");
  }

  setBoot(progress: number, label?: string): void {
    const pct = Math.round(progress * 100);
    this.bootFill.style.width = `${pct}%`;
    this.bootPct.textContent = `${pct}%`;
    if (label) this.bootLabel.textContent = label;
  }

  setReady(): void {
    this.bootFill.style.width = "100%";
    this.bootPct.textContent = "100%";
    this.bootLabel.textContent = "星云已就绪";
    this.startBtn.disabled = false;
    this.demoBtn.disabled = false;
    window.setTimeout(() => this.boot.classList.add("is-done"), 650);
    window.setTimeout(() => {
      this.boot.hidden = true;
    }, 1500);
  }

  setBusy(label: string): void {
    this.startBtn.disabled = true;
    this.demoBtn.disabled = true;
    this.note.classList.remove("is-error");
    this.note.classList.add("is-busy");
    this.note.textContent = label;
  }

  setError(label: string): void {
    this.note.classList.remove("is-busy");
    this.note.classList.add("is-error");
    this.note.textContent = label;
    this.startBtn.disabled = false;
    this.demoBtn.disabled = false;
  }

  setCameraLive(): void {
    this.cameraLive = true;
    this.cam.classList.remove("is-empty");
  }

  setCameraIdle(): void {
    this.cameraLive = false;
    this.trackingReady = false;
    this.cam.classList.add("is-empty");
    this.preview.clear();
  }

  setTrackingReady(): void {
    this.trackingReady = true;
  }

  setMode(mode: "gesture" | "demo"): void {
    this.mode = mode;
    document.body.classList.add("is-live");
    if (mode === "demo") {
      document.body.classList.add("is-demo");
      this.hint.innerHTML = "鼠标移动改变视角 <span>·</span> 滚轮控制扩散 <span>·</span> 自动呼吸中";
    } else {
      document.body.classList.remove("is-demo");
      this.hint.innerHTML = "握拳收缩 <span>·</span> 张掌扩散 <span>·</span> 移动手掌改变视角";
    }
  }

  hideLanding(): void {
    this.landing.classList.add("is-hidden");
    document.body.classList.add("is-live");
  }

  setMuted(muted: boolean): void {
    this.soundBtn.classList.toggle("is-muted", muted);
    this.soundBtn.setAttribute("aria-pressed", String(!muted));
    this.soundBtn.title = muted ? "打开声音" : "关闭声音";
  }

  update(state: HudState): void {
    const energyPercent = Math.round(state.expand * 100);
    this.energy.style.setProperty("--v", state.expand.toFixed(4));
    if (energyPercent !== this.lastEnergy) {
      this.energyValue.textContent = String(energyPercent).padStart(2, "0");
      this.lastEnergy = energyPercent;
    }

    const fps = Math.round(state.fps);
    if (fps !== this.lastFps) {
      this.fps.textContent = `${fps} FPS`;
      this.lastFps = fps;
    }

    if (this.mode === "demo") {
      this.setStatus("自动演示中", "滚轮可手动控制扩散", "idle");
      return;
    }

    if (!this.trackingReady) {
      this.setStatus(
        this.cameraLive ? "正在唤醒手部识别" : "正在连接摄像头",
        this.cameraLive ? "载入手部模型…" : "请允许摄像头权限",
        "idle",
      );
      return;
    }

    if (!state.present) {
      this.setStatus("未检测到手部", "将手掌放入画面中央", "idle");
      return;
    }

    if (state.kind === "fist") {
      this.setStatus("握拳 · 坍缩", "引力收束，核心升温", "fist");
    } else if (state.kind === "open") {
      this.setStatus("展掌 · 扩散", "星云舒展，尘埃远扬", "open");
    } else {
      this.setStatus("半握 · 过渡", "继续握紧或缓缓张开", "mid");
    }
  }

  private setStatus(text: string, sub: string, kind: GestureKind | "idle"): void {
    if (text !== this.lastStatusText) {
      this.statusText.textContent = text;
      this.lastStatusText = text;
    }
    if (sub !== this.lastStatusSub) {
      this.statusSub.textContent = sub;
      this.lastStatusSub = sub;
    }
    this.statusPill.classList.toggle("is-fist", kind === "fist");
    this.statusPill.classList.toggle("is-open", kind === "open");
    this.statusPill.classList.toggle("is-idle", kind === "none" || kind === "idle");
  }

  drawPreview(landmarks: Landmark[] | null, openness: number, present: boolean): void {
    if (!this.cameraLive) return;
    this.preview.draw(landmarks, openness, present);
  }

  toast(message: string, duration = 3800): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove("is-visible");
    }, duration);
  }

  resetNote(): void {
    this.note.classList.remove("is-busy", "is-error");
    this.note.textContent = this.defaultNote;
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      this.toast("当前浏览器不允许进入全屏");
    }
  }
}
