export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing. */
export const damp = (
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number => lerp(current, target, 1 - Math.exp(-lambda * dt));

/**
 * A lightly under-damped spring. The little bit of overshoot is what makes the
 * nebula feel like it has mass instead of just following the hand.
 */
export class Spring {
  value: number;
  velocity = 0;
  private stiffness: number;
  private damping: number;

  constructor(value: number, stiffness = 42, damping = 9.5) {
    this.value = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(target: number, dt: number): number {
    const h = Math.min(dt, 0.033);
    const steps = Math.max(1, Math.ceil(h / 0.008));
    const sub = h / steps;
    for (let i = 0; i < steps; i++) {
      const force = (target - this.value) * this.stiffness;
      this.velocity += force * sub;
      this.velocity *= Math.exp(-this.damping * sub);
      this.value += this.velocity * sub;
    }
    return this.value;
  }
}

/**
 * One Euro filter (Casiez et al.) — smooths the noisy hand signal while still
 * reacting quickly to fast gestures.
 */
export class OneEuroFilter {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0;
  private initialized = false;

  constructor(
    private minCutoff = 1.4,
    private beta = 0.12,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1e-3);
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }
}
