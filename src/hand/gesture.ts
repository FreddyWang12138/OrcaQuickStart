/**
 * Hand geometry → a single, stable "openness" value.
 *
 * Angles between phalanges are largely invariant to hand size, distance from
 * the camera and to the hand's rotation in the image, which makes them a much
 * better signal than a raw tip-to-palm distance. A small tip-to-palm term is
 * blended in to make an open hand feel a little more generous.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandMetrics {
  /** 0 = closed fist, 1 = fully open palm. */
  openness: number;
  /** Finger separation, 0..1. */
  spread: number;
  /** Palm roll in radians, for rotating the nebula. */
  roll: number;
  /** Palm centre, mirrored to selfie view, in 0..1. */
  palmX: number;
  palmY: number;
}

export type GestureKind = "none" | "fist" | "open" | "mid";

export const HAND_CONNECTIONS: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export const FINGERTIPS = [4, 8, 12, 16, 20] as const;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** How far a joint is from straight, in radians. */
function bend(a: Vec3, b: Vec3, c: Vec3): number {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const denom = length(v1) * length(v2);
  if (denom < 1e-6) return 0;
  const cos = clamp((v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / denom, -1, 1);
  return Math.PI - Math.acos(cos);
}

const FINGERS: Array<{
  mcp: number;
  pip: number;
  dip: number;
  tip: number;
  weight: number;
  maxBend: number;
}> = [
  { mcp: 5, pip: 6, dip: 7, tip: 8, weight: 1.0, maxBend: 1.85 },
  { mcp: 9, pip: 10, dip: 11, tip: 12, weight: 1.0, maxBend: 1.85 },
  { mcp: 13, pip: 14, dip: 15, tip: 16, weight: 0.92, maxBend: 1.85 },
  { mcp: 17, pip: 18, dip: 19, tip: 20, weight: 0.82, maxBend: 1.8 },
];

/**
 * @param landmarks 21 MediaPipe hand landmarks
 * @param aspect video width / height (normalised x is corrected with it)
 */
export function analyzeHand(
  landmarks: Landmark[],
  aspect = 16 / 9,
): HandMetrics {
  const p: Vec3[] = landmarks.map((lm) => ({
    x: lm.x * aspect,
    y: lm.y,
    z: lm.z * aspect,
  }));

  const palmCenter: Vec3 = { x: 0, y: 0, z: 0 };
  const palmIds = [0, 5, 9, 13, 17];
  for (const id of palmIds) {
    palmCenter.x += p[id].x;
    palmCenter.y += p[id].y;
    palmCenter.z += p[id].z;
  }
  palmCenter.x /= palmIds.length;
  palmCenter.y /= palmIds.length;
  palmCenter.z /= palmIds.length;

  const handScale = Math.max(distance(p[0], p[9]), 1e-5);

  let curlSum = 0;
  let weightSum = 0;
  for (const finger of FINGERS) {
    const a1 = bend(p[finger.mcp], p[finger.pip], p[finger.dip]);
    const a2 = bend(p[finger.pip], p[finger.dip], p[finger.tip]);
    const curl = clamp((a1 + a2) / 2 / finger.maxBend, 0, 1);
    curlSum += curl * finger.weight;
    weightSum += finger.weight;
  }

  // The thumb folds differently and is the noisiest landmark chain.
  const thumbBend =
    (bend(p[1], p[2], p[3]) + bend(p[2], p[3], p[4])) / 2;
  const thumbCurl = clamp(thumbBend / 1.45, 0, 1);
  curlSum += thumbCurl * 0.55;
  weightSum += 0.55;

  const angleOpen = 1 - curlSum / weightSum;

  // Tip-to-palm extension, used only as a gentle supporting signal.
  let extension = 0;
  for (const finger of FINGERS) {
    extension += distance(p[finger.tip], palmCenter) / handScale;
  }
  extension /= FINGERS.length;
  const extensionOpen = smoothstep(0.55, 1.35, extension);

  let rawOpen = angleOpen * 0.78 + extensionOpen * 0.22;
  rawOpen = smoothstep(0.08, 0.92, rawOpen);

  // Finger spread: how far the fingertips are from each other.
  const palmWidth = Math.max(distance(p[5], p[17]), handScale * 0.55, 1e-5);
  const spreadRaw =
    (distance(p[8], p[12]) + distance(p[12], p[16]) + distance(p[16], p[20])) /
    3 /
    palmWidth;
  const spread = smoothstep(0.45, 1.45, spreadRaw);

  const roll = clamp(
    Math.atan2(p[17].y - p[5].y, p[17].x - p[5].x) * 0.9,
    -1.15,
    1.15,
  );

  const palmX = clamp(1 - (landmarks[9].x * 0.4 + landmarks[0].x * 0.6), 0, 1);
  const palmY = clamp(1 - (landmarks[9].y * 0.4 + landmarks[0].y * 0.6), 0, 1);

  return {
    openness: clamp(rawOpen, 0, 1),
    spread: clamp(spread, 0, 1),
    roll,
    palmX,
    palmY,
  };
}

/** Hysteresis so the HUD label does not flicker around the thresholds. */
export class GestureClassifier {
  private kind: GestureKind = "none";

  update(openness: number, present: boolean): GestureKind {
    if (!present) {
      this.kind = "none";
      return this.kind;
    }
    if (this.kind === "fist") {
      if (openness > 0.36) this.kind = openness > 0.68 ? "open" : "mid";
    } else if (this.kind === "open") {
      if (openness < 0.62) this.kind = openness < 0.28 ? "fist" : "mid";
    } else if (openness < 0.27) {
      this.kind = "fist";
    } else if (openness > 0.7) {
      this.kind = "open";
    } else {
      this.kind = "mid";
    }
    return this.kind;
  }

  get current(): GestureKind {
    return this.kind;
  }
}
