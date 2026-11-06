import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { analyzeHand, type HandMetrics, type Landmark } from "./gesture";

export interface HandFrame extends HandMetrics {
  present: boolean;
  landmarks: Landmark[] | null;
  lastSeen: number;
}

const EMPTY_FRAME: HandFrame = {
  present: false,
  openness: 0,
  spread: 0,
  roll: 0,
  palmX: 0.5,
  palmY: 0.5,
  landmarks: null,
  lastSeen: 0,
};

export class CameraError extends Error {}

/**
 * Owns the webcam stream and MediaPipe's hand landmarker. Runs detection in a
 * requestAnimationFrame loop and exposes the latest analysed frame.
 */
export class HandTracker {
  private readonly video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private raf = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private lastSeen = 0;
  private lastDetectAt = 0;
  private detectInterval = 40;
  private latest: HandFrame = { ...EMPTY_FRAME };

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get frame(): HandFrame {
    return this.latest;
  }

  get active(): boolean {
    return this.running;
  }

  get aspect(): number {
    if (!this.video.videoWidth || !this.video.videoHeight) return 16 / 9;
    return this.video.videoWidth / this.video.videoHeight;
  }

  async startCamera(): Promise<void> {
    if (!window.isSecureContext) {
      throw new CameraError("摄像头需要 secure context，请通过 localhost 或 HTTPS 打开页面。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("当前浏览器不支持摄像头访问。");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new CameraError("摄像头权限被拒绝。请在浏览器地址栏的权限设置中允许摄像头。");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new CameraError("没有找到可用的摄像头设备。");
      }
      throw new CameraError("无法打开摄像头，请检查设备是否被其他应用占用。");
    }

    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);

    if (!this.video.videoWidth) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new CameraError("摄像头画面迟迟没有就绪。")), 6000);
        this.video.addEventListener(
          "loadedmetadata",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  async loadModel(delegate: "GPU" | "CPU" = "GPU"): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
    const options = {
      baseOptions: {
        modelAssetPath: `${base}models/hand_landmarker.task`,
        delegate,
      },
      runningMode: "VIDEO" as const,
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    };

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch (error) {
      console.warn("[hand] GPU delegate unavailable, falling back to CPU", error);
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
        });
      } catch (cpuError) {
        console.error("[hand] failed to initialise landmarker", cpuError);
        throw new CameraError("手部识别模型加载失败，请刷新页面重试。");
      }
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    this.lastVideoTime = -1;
    this.tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.latest = { ...EMPTY_FRAME };
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const video = this.video;
    if (document.hidden || video.readyState < 2) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const now = performance.now();
    if (now - this.lastDetectAt < this.detectInterval) return;
    this.lastDetectAt = now;

    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    try {
      const result = this.landmarker?.detectForVideo(video, timestamp);
      if (result) this.handleResult(result, now);
    } catch (error) {
      console.warn("[hand] detection failed", error);
    }
  };

  private handleResult(result: HandLandmarkerResult, now: number): void {
    const landmarks = result.landmarks?.[0];
    if (landmarks && landmarks.length === 21) {
      const metrics = analyzeHand(landmarks, this.aspect);
      this.lastSeen = now;
      this.latest = {
        present: true,
        ...metrics,
        landmarks,
        lastSeen: now,
      };
      return;
    }

    // Short gaps are common while a hand is moving quickly: hold the last
    // reading for a beat instead of snapping the nebula back to idle.
    if (this.latest.present && now - this.lastSeen < 260) {
      this.latest = { ...this.latest, landmarks: null, lastSeen: this.lastSeen };
      return;
    }

    this.latest = {
      ...EMPTY_FRAME,
      palmX: this.latest.palmX,
      palmY: this.latest.palmY,
      lastSeen: this.lastSeen,
    };
  }
}
