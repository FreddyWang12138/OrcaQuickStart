const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface GestureThresholds {
  fist: number;
  release: number;
}

export const DEFAULT_THRESHOLDS: GestureThresholds = { fist: 0.28, release: 0.6 };

/**
 * Two quick holds to learn where this particular hand / camera / lighting
 * puts "closed" and "open". Falls back to sane defaults if the readings are
 * too close together or the user skips.
 */
export class Calibration {
  step: 0 | 1 | 2 = 0;
  progress = 0;
  done = false;

  private fistMin = 1;
  private openMax = 0;
  private fistValue = 0.2;
  private openValue = 0.8;
  private stillTime = 0;

  get title(): string {
    return this.step === 0 ? "先握紧拳头" : "再张开手掌";
  }

  get hint(): string {
    return this.step === 0
      ? "保持约 1 秒，让星核记住你的握力"
      : "手掌完全摊开，保持约 1 秒";
  }

  get stepLabel(): string {
    return `STEP ${Math.min(this.step + 1, 2)} / 2`;
  }

  get thresholds(): GestureThresholds {
    if (this.openValue - this.fistValue < 0.22) return { ...DEFAULT_THRESHOLDS };
    const fist = clamp(this.fistValue + 0.15, 0.2, 0.52);
    const release = clamp(
      Math.max(fist + 0.14, lerp(fist, this.openValue, 0.52)),
      fist + 0.12,
      0.85,
    );
    return { fist, release };
  }

  reset(): void {
    this.step = 0;
    this.progress = 0;
    this.done = false;
    this.fistMin = 1;
    this.openMax = 0;
    this.fistValue = 0.2;
    this.openValue = 0.8;
    this.stillTime = 0;
  }

  skip(): GestureThresholds {
    this.done = true;
    this.step = 2;
    this.progress = 1;
    this.fistValue = 0.1;
    this.openValue = 0.9;
    return { ...DEFAULT_THRESHOLDS };
  }

  /** Returns true when calibration just completed. */
  update(dt: number, openness: number, present: boolean): boolean {
    if (this.done) return false;

    if (!present) {
      this.progress = Math.max(0, this.progress - dt * 1.6);
      this.stillTime = 0;
      return false;
    }

    const target = this.step === 0 ? openness < 0.5 : openness > 0.55;
    if (target) {
      this.stillTime += dt;
      this.progress = Math.min(1, this.progress + dt / 1.1);
      if (this.step === 0) this.fistMin = Math.min(this.fistMin, openness);
      else this.openMax = Math.max(this.openMax, openness);
    } else {
      this.stillTime = 0;
      this.progress = Math.max(0, this.progress - dt / 1.8);
    }

    if (this.progress < 1) return false;

    if (this.step === 0) {
      this.fistValue = this.fistMin;
      this.step = 1;
      this.progress = 0;
      this.stillTime = 0;
      return false;
    }

    this.openValue = this.openMax;
    this.done = true;
    this.step = 2;
    return true;
  }
}
