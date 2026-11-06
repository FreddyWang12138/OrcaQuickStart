import { FINGERTIPS, HAND_CONNECTIONS, type Landmark } from "../hand/gesture";

/**
 * Draws the mirrored camera preview annotation: skeleton, joints and a palm
 * aura that reacts to the gesture.
 */
export class CameraPreview {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  draw(landmarks: Landmark[] | null, openness: number, present: boolean): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks || !present) return;

    const closed = Math.min(1, Math.max(0, 1 - openness));
    const accent: [number, number, number] = [
      Math.round(140 + 112 * closed),
      Math.round(240 - 60 * closed),
      Math.round(255 - 40 * closed),
    ];
    const accentCss = `rgb(${accent[0]}, ${accent[1]}, ${accent[2]})`;

    const px = (x: number) => x * width;
    const py = (y: number) => y * height;

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);

    // palm aura
    const palmIds = [0, 5, 9, 13, 17];
    let cx = 0;
    let cy = 0;
    for (const id of palmIds) {
      cx += landmarks[id].x;
      cy += landmarks[id].y;
    }
    cx = px(cx / palmIds.length);
    cy = py(cy / palmIds.length);
    const auraRadius = 34 + openness * 34;
    const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, auraRadius);
    gradient.addColorStop(0, `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.20)`);
    gradient.addColorStop(0.55, `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.06)`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
    ctx.fill();

    // bones
    ctx.lineWidth = 1.35;
    ctx.strokeStyle = "rgba(205, 236, 255, 0.52)";
    ctx.shadowColor = accentCss;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(px(landmarks[a].x), py(landmarks[a].y));
      ctx.lineTo(px(landmarks[b].x), py(landmarks[b].y));
    }
    ctx.stroke();

    // joints
    ctx.shadowBlur = 5;
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    for (let i = 0; i < landmarks.length; i++) {
      if ((FINGERTIPS as readonly number[]).includes(i)) continue;
      ctx.beginPath();
      ctx.arc(px(landmarks[i].x), py(landmarks[i].y), 1.65, 0, Math.PI * 2);
      ctx.fill();
    }

    // fingertips
    ctx.shadowColor = accentCss;
    ctx.shadowBlur = 14;
    ctx.fillStyle = accentCss;
    for (const tip of FINGERTIPS) {
      ctx.beginPath();
      ctx.arc(px(landmarks[tip].x), py(landmarks[tip].y), 2.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
