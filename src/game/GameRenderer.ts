import type { Game } from "./Game";

const TAU = Math.PI * 2;
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/** Small seeded PRNG so entity visuals stay stable frame to frame. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return [canvas, ctx];
}

export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private cx = 0.5;
  private cy = 0.5;
  private unit = 1;

  private readonly mote: HTMLCanvasElement;
  private readonly shards: HTMLCanvasElement[] = [];
  private readonly heavy: HTMLCanvasElement;
  private readonly comet: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.mote = this.createMote();
    for (let i = 0; i < 3; i++) this.shards.push(this.createShard(i, false));
    this.heavy = this.createShard(7, true);
    this.comet = this.createComet();
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.unit = Math.min(this.width, this.height);
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  draw(game: Game, clenched: boolean): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const unit = this.unit;
    const cx = this.cx;
    const cy = this.cy;
    const time = game.time;
    const gold = game.supernova > 0;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // gravity well aura while clenching
    if (clenched && game.phase === "playing") {
      const radius = unit * (0.24 + game.pressure * 0.2);
      const gradient = ctx.createRadialGradient(cx, cy, unit * 0.02, cx, cy, radius);
      const a = 0.04 + game.pressure * 0.1;
      gradient.addColorStop(0, `rgba(190, 170, 255, ${a})`);
      gradient.addColorStop(0.5, `rgba(140, 100, 255, ${a * 0.35})`);
      gradient.addColorStop(1, "rgba(80, 40, 160, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();
    }

    this.drawCore(game, clenched, time);
    this.drawEffects(game);
    this.drawEntities(game);
    this.drawShockwaves(game, time);
    this.drawPopups(game);

    ctx.restore();

    if (game.flash > 0) this.drawFlash(game);

    // supernova corona
    if (gold) {
      const flicker = 0.65 + 0.35 * Math.sin(time * 9);
      const radius = unit * 0.16;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, `rgba(255, 236, 180, ${0.22 * flicker})`);
      g.addColorStop(0.45, `rgba(255, 150, 60, ${0.1 * flicker})`);
      g.addColorStop(1, "rgba(255, 110, 40, 0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();
    }
  }

  private drawCore(game: Game, clenched: boolean, time: number): void {
    const ctx = this.ctx;
    const coreR = game.coreRadius() * this.unit;
    const gold = game.supernova > 0;
    const pulse = 0.85 + 0.15 * Math.sin(time * (clenched ? 7 : 2.4));

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // event horizon
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, coreR + 8, 0, TAU);
    ctx.strokeStyle = gold ? "rgba(255, 218, 150, 0.55)" : "rgba(188, 226, 255, 0.32)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // pressure arc
    const radius = coreR + 13;
    const start = -Math.PI / 2;
    const gradient = ctx.createLinearGradient(this.cx - radius, 0, this.cx + radius, 0);
    if (gold) {
      gradient.addColorStop(0, "#ffe6a8");
      gradient.addColorStop(0.5, "#ffb04a");
      gradient.addColorStop(1, "#ff6a8a");
    } else {
      gradient.addColorStop(0, "#7fe6ff");
      gradient.addColorStop(0.55, "#b79bff");
      gradient.addColorStop(1, "#ff6aa8");
    }
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, radius, start, start + TAU * Math.max(0.015, game.pressure));
    ctx.strokeStyle = gold ? "rgba(255, 190, 110, 0.14)" : "rgba(183, 155, 255, 0.14)";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // charged core point
    const coreGlow = 0.3 + game.pressure * 0.7;
    ctx.globalAlpha = pulse * coreGlow;
    const g = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, coreR * 1.3);
    g.addColorStop(0, "rgba(255, 255, 250, 1)");
    g.addColorStop(0.25, gold ? "rgba(255, 214, 140, 0.8)" : "rgba(226, 214, 255, 0.7)");
    g.addColorStop(1, "rgba(160, 130, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, coreR * 1.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawEntities(game: Game): void {
    const ctx = this.ctx;
    const unit = this.unit;
    const cx = this.cx;
    const cy = this.cy;

    for (const entity of game.entities) {
      const x = cx + entity.x * unit;
      const y = cy + entity.y * unit;
      if (x < -140 || x > this.width + 140 || y < -140 || y > this.height + 140) continue;
      const fade = Math.min(1, entity.age / 0.4);

      if (entity.kind === "mote") {
        const size = unit * 0.052 * (0.9 + ((entity.seed % 10) / 10) * 0.2);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.2 * fade;
        this.drawSprite(this.mote, x - entity.vx * unit * 0.06, y - entity.vy * unit * 0.06, size * 0.65);
        ctx.globalAlpha = 0.26 * fade;
        this.drawSprite(this.mote, x - entity.vx * unit * 0.11, y - entity.vy * unit * 0.11, size * 0.45);
        ctx.globalAlpha = fade;
        this.drawSprite(this.mote, x, y, size * (0.92 + Math.sin(game.time * 4 + entity.seed) * 0.08));
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = fade;
      if (entity.kind === "comet") {
        ctx.rotate(Math.atan2(entity.vy, entity.vx));
        ctx.globalCompositeOperation = "lighter";
        this.drawSprite(this.comet, 0, 0, unit * 0.2);
      } else if (entity.kind === "heavy") {
        ctx.rotate(entity.spin);
        this.drawSprite(this.heavy, 0, 0, unit * 0.135);
      } else {
        ctx.rotate(entity.spin);
        const sprite = this.shards[Math.floor(entity.seed) % this.shards.length];
        this.drawSprite(sprite, 0, 0, unit * 0.082);
      }
      ctx.restore();
    }
  }

  private drawShockwaves(game: Game, time: number): void {
    const ctx = this.ctx;
    const unit = this.unit;
    const gold = game.supernova > 0;

    for (const ring of game.shockwaves) {
      const t = Math.min(1, ring.age / ring.duration);
      const fade = Math.pow(1 - t, 1.2);
      const radius = ring.radius * unit;
      const hot = gold || ring.power > 0.7;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius, 0, TAU);
      ctx.strokeStyle = hot
        ? `rgba(255, 206, 140, ${fade * 0.16})`
        : `rgba(150, 210, 255, ${fade * 0.15})`;
      ctx.lineWidth = 12 + ring.power * 16;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius, 0, TAU);
      ctx.strokeStyle = hot
        ? `rgba(255, 226, 176, ${fade * 0.9})`
        : `rgba(170, 228, 255, ${fade * 0.85})`;
      ctx.lineWidth = 1.2 + ring.power * 3.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius * 0.93, 0, TAU);
      ctx.strokeStyle = hot
        ? `rgba(255, 120, 120, ${fade * 0.28})`
        : `rgba(190, 140, 255, ${fade * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // radial streaks riding the leading edge
      const inner = radius * 0.9;
      const outer = radius * (1.045 + 0.02 * Math.sin(time * 8 + ring.power * 7));
      ctx.strokeStyle = hot
        ? `rgba(255, 226, 180, ${fade * 0.4})`
        : `rgba(190, 235, 255, ${fade * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * TAU + time * 0.12;
        ctx.moveTo(this.cx + Math.cos(angle) * inner, this.cy + Math.sin(angle) * inner);
        ctx.lineTo(this.cx + Math.cos(angle) * outer, this.cy + Math.sin(angle) * outer);
      }
      ctx.stroke();

      // leading edge shimmer
      ctx.globalAlpha = fade * 0.22;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius * (1 + 0.01 * Math.sin(time * 9 + ring.power * 8)), 0, TAU);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawEffects(game: Game): void {
    const ctx = this.ctx;
    const unit = this.unit;
    const cx = this.cx;
    const cy = this.cy;

    for (const effect of game.effects) {
      const t = Math.min(1, effect.age / effect.life);
      const fade = Math.pow(1 - t, 1.4);
      const x = cx + effect.x * unit;
      const y = cy + effect.y * unit;
      const rand = mulberry32(Math.floor(effect.seed * 997) + 1);

      if (effect.kind === "shock") continue; // the actual shockwave ring handles this
      if (effect.kind === "supernova") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const radius = unit * (0.1 + t * 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.strokeStyle = `rgba(255, 220, 160, ${fade * 0.8})`;
        ctx.lineWidth = 2 + (1 - t) * 4;
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (effect.kind === "absorb") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(cx, cy);
        for (let i = 0; i < 7; i++) {
          const angle = rand() * TAU;
          const length = unit * (0.015 + t * 0.055) * (0.5 + rand());
          ctx.strokeStyle = `rgba(255, 224, 160, ${fade * 0.65})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * length * 0.3, Math.sin(angle) * length * 0.3);
          ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      if (effect.kind === "shatter") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const color = effect.power > 0.6 ? "255, 110, 180" : "180, 130, 255";
        for (let i = 0; i < 10; i++) {
          const angle = rand() * TAU;
          const dist = unit * (0.012 + t * 0.09) * (0.5 + rand());
          const size = 1.5 + rand() * 2.5;
          ctx.fillStyle = `rgba(${color}, ${fade * 0.75})`;
          ctx.beginPath();
          ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, size, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      if (effect.kind === "miss") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.arc(x, y, unit * (0.01 + t * 0.035), 0, TAU);
        ctx.strokeStyle = `rgba(150, 190, 255, ${fade * 0.35})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (effect.kind === "damage") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.arc(cx, cy, unit * (0.055 + t * 0.07), 0, TAU);
        ctx.strokeStyle = `rgba(255, 86, 120, ${fade * 0.8})`;
        ctx.lineWidth = 2 + (1 - t) * 4;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawPopups(game: Game): void {
    const ctx = this.ctx;
    const unit = this.unit;
    for (const popup of game.popups) {
      const t = Math.min(1, popup.age / popup.life);
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const x = this.cx + popup.x * unit;
      const y = this.cy + popup.y * unit;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = popup.big ? "rgba(255, 226, 168, 0.95)" : "rgba(225, 240, 255, 0.8)";
      ctx.font = `${popup.big ? 600 : 500} ${popup.big ? 15 : 11}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText(popup.text, x, y);
      ctx.restore();
    }
  }

  private drawFlash(game: Game): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.unit * 0.9);
    gradient.addColorStop(0, "rgba(255, 40, 90, 0)");
    gradient.addColorStop(0.6, `rgba(255, 30, 80, ${game.flash * 0.1})`);
    gradient.addColorStop(1, `rgba(255, 10, 60, ${game.flash * 0.26})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  private drawSprite(sprite: HTMLCanvasElement, x: number, y: number, size: number): void {
    this.ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  private createMote(): HTMLCanvasElement {
    const [canvas, ctx] = makeCanvas(64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, "rgba(255, 255, 245, 1)");
    gradient.addColorStop(0.12, "rgba(255, 244, 205, 1)");
    gradient.addColorStop(0.32, "rgba(255, 196, 110, 0.72)");
    gradient.addColorStop(0.6, "rgba(255, 140, 70, 0.18)");
    gradient.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(255, 248, 220, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(32, 20);
    ctx.moveTo(32, 44);
    ctx.lineTo(32, 56);
    ctx.moveTo(8, 32);
    ctx.lineTo(20, 32);
    ctx.moveTo(44, 32);
    ctx.lineTo(56, 32);
    ctx.stroke();
    return canvas;
  }

  private createShard(seed: number, heavy: boolean): HTMLCanvasElement {
    const size = heavy ? 128 : 96;
    const [canvas, ctx] = makeCanvas(size);
    const c = size / 2;
    const rand = mulberry32(seed * 97 + 13);
    const points: Array<[number, number]> = [];
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * TAU + rand() * 0.18;
      const radius = c * (heavy ? 0.5 + rand() * 0.28 : 0.38 + rand() * 0.3);
      points.push([c + Math.cos(angle) * radius, c + Math.sin(angle) * radius]);
    }
    const edge = heavy ? "rgba(255, 92, 120, 0.95)" : "rgba(255, 92, 190, 0.9)";
    const inner = heavy ? "rgba(70, 8, 20, 0.98)" : "rgba(18, 4, 34, 0.98)";

    ctx.save();
    ctx.shadowColor = heavy ? "rgba(255, 70, 90, 0.9)" : "rgba(255, 70, 180, 0.8)";
    ctx.shadowBlur = heavy ? 26 : 16;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = heavy ? 2.4 : 1.8;
    ctx.stroke();

    // inner facet lines
    ctx.shadowBlur = 0;
    ctx.strokeStyle = heavy ? "rgba(255, 140, 140, 0.32)" : "rgba(200, 140, 255, 0.28)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const [x, y] = points[(i * 2 + 1) % points.length];
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    if (heavy) {
      ctx.beginPath();
      ctx.arc(c, c, c * 0.12, 0, TAU);
      ctx.fillStyle = "rgba(255, 120, 90, 0.85)";
      ctx.fill();
    }
    ctx.restore();
    return canvas;
  }

  private createComet(): HTMLCanvasElement {
    const [canvas, ctx] = makeCanvas(160);
    const headX = 124;
    const headY = 80;
    const gradient = ctx.createLinearGradient(8, headY, headX, headY);
    gradient.addColorStop(0, "rgba(120, 200, 255, 0)");
    gradient.addColorStop(0.55, "rgba(150, 220, 255, 0.22)");
    gradient.addColorStop(0.88, "rgba(215, 245, 255, 0.75)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.95)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(12, headY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.moveTo(40, headY);
    ctx.lineTo(headX - 14, headY);
    ctx.stroke();

    const halo = ctx.createRadialGradient(headX, headY, 0, headX, headY, 30);
    halo.addColorStop(0, "rgba(255, 255, 255, 1)");
    halo.addColorStop(0.2, "rgba(220, 248, 255, 0.95)");
    halo.addColorStop(0.55, "rgba(140, 215, 255, 0.35)");
    halo.addColorStop(1, "rgba(100, 180, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(headX, headY, 30, 0, TAU);
    ctx.fill();
    return canvas;
  }


}
