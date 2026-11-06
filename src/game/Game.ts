/**
 * "PULSE" core simulation — deliberately DOM-free so it can be unit-tested.
 *
 * Everything is expressed in stage units where 1 = the shorter screen side.
 * The core sits at (0, 0); x spans ±aspect/2 and y spans ±0.5.
 */

export type EntityKind = "mote" | "shard" | "heavy" | "comet";
export type GamePhase = "idle" | "playing" | "paused" | "over";
export type EffectKind = "absorb" | "shatter" | "damage" | "shock" | "supernova" | "miss";

export interface GameEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spin: number;
  spinSpeed: number;
  seed: number;
  age: number;
  pushed: boolean;
}

export interface Shockwave {
  startRadius: number;
  radius: number;
  prevRadius: number;
  maxRadius: number;
  power: number;
  age: number;
  duration: number;
  hit: Set<number>;
}

export interface GameEffect {
  kind: EffectKind;
  x: number;
  y: number;
  age: number;
  life: number;
  power: number;
  seed: number;
}

export interface Popup {
  x: number;
  y: number;
  age: number;
  life: number;
  text: string;
  big: boolean;
}

export type GameEvent =
  | { type: "absorb"; value: number; kind: EntityKind }
  | { type: "shatter"; power: number; perfect: boolean }
  | { type: "damage"; lives: number }
  | { type: "shockwave"; power: number }
  | { type: "wave"; wave: number }
  | { type: "supernova" }
  | { type: "gameover"; victory: boolean }
  | { type: "pause" }
  | { type: "resume" };

export interface GameInput {
  clenched: boolean;
  present: boolean;
}

export interface GameResults {
  victory: boolean;
  score: number;
  best: number;
  bonus: number;
  wave: number;
  lives: number;
  maxCombo: number;
  absorbed: number;
  destroyed: number;
  rankCn: string;
  rankEn: string;
}

interface WaveConfig {
  duration: number;
  interval: number;
  speed: number;
  weights: Record<EntityKind, number>;
}

interface Rank {
  cn: string;
  en: string;
}

const WAVES: WaveConfig[] = [
  {
    duration: 24,
    interval: 0.85,
    speed: 0.082,
    weights: { mote: 0.68, shard: 0.32, heavy: 0, comet: 0 },
  },
  {
    duration: 27,
    interval: 0.76,
    speed: 0.092,
    weights: { mote: 0.6, shard: 0.26, heavy: 0.14, comet: 0 },
  },
  {
    duration: 30,
    interval: 0.62,
    speed: 0.102,
    weights: { mote: 0.54, shard: 0.22, heavy: 0.11, comet: 0.13 },
  },
];

const RANKS: Array<{ min: number; rank: Rank }> = [
  { min: 4500, rank: { cn: "超新星", en: "SUPERNOVA" } },
  { min: 2600, rank: { cn: "中子星", en: "NEUTRON STAR" } },
  { min: 1200, rank: { cn: "白矮星", en: "WHITE DWARF" } },
  { min: 0, rank: { cn: "原恒星", en: "PROTOSTAR" } },
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Game {
  phase: GamePhase = "idle";
  aspect = 16 / 9;

  score = 0;
  best = 0;
  lives = 3;
  combo = 0;
  maxCombo = 0;
  pressure = 0;
  mass = 0;
  wave = 1;
  waveTime = 0;
  waveBanner = 0;
  supernova = 0;
  invuln = 0;
  flash = 0;
  shake = 0;
  time = 0;

  entities: GameEntity[] = [];
  shockwaves: Shockwave[] = [];
  effects: GameEffect[] = [];
  popups: Popup[] = [];

  stats = { absorbed: 0, destroyed: 0, perfect: 0 };
  results: GameResults | null = null;

  private events: GameEvent[] = [];
  private spawnTimer = 0;
  private cooldown = 0;
  private wasClenched = false;
  private lostTime = 0;
  private presentTime = 0;
  private comboTime = 0;
  private nextId = 1;

  constructor() {
    this.reset();
  }

  get waveConfig(): WaveConfig {
    return WAVES[Math.min(this.wave, WAVES.length) - 1];
  }

  get waveCount(): number {
    return WAVES.length;
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0.2) this.aspect = aspect;
  }

  coreRadius(): number {
    return 0.055 + this.pressure * 0.03 + (this.supernova > 0 ? 0.012 : 0);
  }

  /** Clears the board for a fresh run without starting the simulation yet. */
  prepare(best: number): void {
    this.reset();
    this.best = Math.max(0, best);
  }

  /** Starts the prepared run (called after the countdown). */
  begin(): void {
    if (this.phase !== "idle") return;
    this.phase = "playing";
    this.waveBanner = 1.35;
    this.spawnTimer = 0.55;
    // Seed the opening beat so the player has something to read immediately.
    this.spawn("mote");
    this.spawn("mote");
    this.spawn("shard");
    this.events.push({ type: "wave", wave: 1 });
  }

  start(best: number): void {
    this.prepare(best);
    this.begin();
  }

  private reset(): void {
    this.phase = "idle";
    this.score = 0;
    this.lives = 3;
    this.combo = 0;
    this.maxCombo = 0;
    this.pressure = 0;
    this.mass = 0;
    this.wave = 1;
    this.waveTime = 0;
    this.waveBanner = 0;
    this.supernova = 0;
    this.invuln = 0;
    this.flash = 0;
    this.shake = 0;
    this.time = 0;
    this.entities = [];
    this.shockwaves = [];
    this.effects = [];
    this.popups = [];
    this.stats = { absorbed: 0, destroyed: 0, perfect: 0 };
    this.results = null;
    this.events = [];
    this.spawnTimer = 0;
    this.cooldown = 0;
    this.wasClenched = false;
    this.lostTime = 0;
    this.presentTime = 0;
    this.comboTime = 0;
    this.nextId = 1;
  }

  update(dt: number, input: GameInput): void {
    dt = Math.min(0.05, Math.max(0, dt));
    if (dt === 0) return;

    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.shake = Math.max(0, this.shake - dt * 3.4);
    this.updateCosmetics(dt);

    if (this.phase === "idle" || this.phase === "over") return;

    if (!input.present) {
      this.lostTime += dt;
      if (this.phase === "playing" && this.lostTime > 1.1) {
        this.phase = "paused";
        this.wasClenched = false;
        this.presentTime = 0;
        this.events.push({ type: "pause" });
      }
      return;
    }

    this.lostTime = 0;
    if (this.phase === "paused") {
      this.presentTime += dt;
      if (this.presentTime > 0.55) {
        this.phase = "playing";
        this.presentTime = 0;
        this.events.push({ type: "resume" });
      }
      return;
    }

    // ---- playing ----------------------------------------------------------
    this.invuln = Math.max(0, this.invuln - dt);
    this.supernova = Math.max(0, this.supernova - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.waveBanner = Math.max(0, this.waveBanner - dt);

    if (this.comboTime > 0) {
      this.comboTime -= dt;
      if (this.comboTime <= 0) this.combo = 0;
    }

    this.updatePressure(dt, input.clenched);
    this.updateSpawn(dt);
    this.updateEntities(dt, input.clenched);
    this.updateShockwaves(dt);
    this.updateWave(dt);
  }

  private updatePressure(dt: number, clenched: boolean): void {
    if (clenched) {
      this.wasClenched = true;
      // Holding your breath charges slowly; swallowing motes is the real fuel.
      const rate = 0.18 + (this.supernova > 0 ? 0.08 : 0);
      this.pressure = Math.min(1, this.pressure + dt * rate);
      return;
    }

    if (!this.wasClenched) return;
    this.wasClenched = false;
    if (this.pressure >= 0.12 && this.cooldown <= 0) {
      this.fireShockwave(this.pressure, false);
    }
    this.pressure = 0;
  }

  private updateSpawn(dt: number): void {
    if (this.waveBanner > 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const config = this.waveConfig;
    const kind = this.pickKind(config);
    this.spawn(kind);
    if (kind === "mote" && Math.random() < 0.18) {
      this.spawn("mote");
    }
    this.spawnTimer = config.interval * (0.72 + Math.random() * 0.55);
  }

  private pickKind(config: WaveConfig): EntityKind {
    const roll = Math.random();
    let total = 0;
    for (const kind of ["mote", "shard", "heavy", "comet"] as const) {
      total += config.weights[kind];
      if (roll <= total) return kind;
    }
    return "mote";
  }

  private spawn(kind: EntityKind): void {
    if (this.entities.length >= 52) return;

    const angle = Math.random() * Math.PI * 2;
    const halfW = 0.5 * this.aspect + 0.1;
    const halfH = 0.6;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const tx = Math.abs(dx) > 1e-4 ? halfW / Math.abs(dx) : 1e9;
    const ty = Math.abs(dy) > 1e-4 ? halfH / Math.abs(dy) : 1e9;
    const dist = Math.min(tx, ty) * (0.94 + Math.random() * 0.08);
    const x = dx * dist;
    const y = dy * dist;

    const config = this.waveConfig;
    const speedScale = kind === "comet" ? 1.9 : kind === "heavy" ? 0.72 : 1;
    const speed = config.speed * speedScale * (0.9 + Math.random() * 0.2);
    const aim = Math.atan2(-y, -x) + (Math.random() - 0.5) * 0.14;

    const radius =
      kind === "mote" ? 0.013 : kind === "shard" ? 0.018 : kind === "heavy" ? 0.03 : 0.022;

    this.entities.push({
      id: this.nextId++,
      kind,
      x,
      y,
      vx: Math.cos(aim) * speed,
      vy: Math.sin(aim) * speed,
      r: radius,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 2.4,
      seed: Math.random() * 100,
      age: 0,
      pushed: false,
    });
  }

  private updateEntities(dt: number, clenched: boolean): void {
    const supernovaBoost = this.supernova > 0 ? 1.32 : 1;
    const pull = (0.55 + this.pressure * 1.15) * supernovaBoost;
    const coreR = this.coreRadius();
    const halfW = 0.5 * this.aspect + 0.45;
    const removed = new Set<number>();

    for (const entity of this.entities) {
      entity.age += dt;
      entity.spin += entity.spinSpeed * dt;

      const d = Math.hypot(entity.x, entity.y);
      if (clenched && d > 1e-4) {
        const inv = 1 / Math.max(d, 0.05);
        const power = pull * (entity.kind === "comet" ? 0.55 : 1);
        entity.vx += (-entity.x * inv * power - entity.y * inv * power * 0.22) * dt;
        entity.vy += (-entity.y * inv * power + entity.x * inv * power * 0.22) * dt;

        const speed = Math.hypot(entity.vx, entity.vy);
        const maxSpeed = 1.6;
        if (speed > maxSpeed) {
          entity.vx = (entity.vx / speed) * maxSpeed;
          entity.vy = (entity.vy / speed) * maxSpeed;
        }
      }

      entity.x += entity.vx * dt;
      entity.y += entity.vy * dt;

      const dist = Math.hypot(entity.x, entity.y);
      if (dist < coreR + entity.r && this.resolveCore(entity, clenched)) {
        removed.add(entity.id);
      }
    }

    this.entities = this.entities.filter(
      (entity) =>
        !removed.has(entity.id) &&
        entity.x > -halfW &&
        entity.x < halfW &&
        entity.y > -0.95 &&
        entity.y < 0.95,
    );
  }

  /** Returns true when the entity should be removed from the field. */
  private resolveCore(entity: GameEntity, clenched: boolean): boolean {
    if (entity.kind === "mote") {
      if (!clenched) {
        this.effects.push({
          kind: "miss",
          x: entity.x,
          y: entity.y,
          age: 0,
          life: 0.45,
          power: 0.4,
          seed: entity.seed,
        });
        return true;
      }
      this.absorb(entity);
      return true;
    }

    this.damage(entity.kind === "comet" ? 2 : 1, entity.x, entity.y);
    return true;
  }

  private absorb(entity: GameEntity): void {
    this.stats.absorbed++;
    this.mass = Math.min(1, this.mass + (entity.kind === "comet" ? 0.15 : 0.06));
    this.pressure = Math.min(1, this.pressure + (entity.kind === "comet" ? 0.18 : 0.09));
    const base = entity.kind === "comet" ? 90 : 12;
    const value = this.award(base, entity.x, entity.y);
    this.effects.push({
      kind: entity.kind === "comet" ? "shatter" : "absorb",
      x: entity.x,
      y: entity.y,
      age: 0,
      life: 0.55,
      power: entity.kind === "comet" ? 0.8 : 0.5,
      seed: entity.seed,
    });
    this.events.push({ type: "absorb", value, kind: entity.kind });
    if (this.mass >= 1) this.triggerSupernova();
  }

  private damage(amount: number, x: number, y: number): void {
    if (this.invuln > 0) {
      this.effects.push({ kind: "miss", x, y, age: 0, life: 0.4, power: 0.5, seed: Math.random() * 99 });
      return;
    }
    this.lives = Math.max(0, this.lives - amount);
    this.combo = 0;
    this.comboTime = 0;
    this.invuln = 1.8;
    this.flash = 1;
    this.shake = 0.8;
    this.effects.push({ kind: "damage", x, y, age: 0, life: 0.9, power: 1, seed: Math.random() * 99 });
    this.events.push({ type: "damage", lives: this.lives });
    if (this.lives <= 0) this.endGame(false);
  }

  private award(base: number, x: number, y: number): number {
    this.combo = Math.min(30, this.combo + 1);
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTime = 6;
    const comboMult = 1 + this.combo * 0.05;
    const pressureMult = 1 + this.pressure * 0.4;
    const superMult = this.supernova > 0 ? 2 : 1;
    const value = Math.max(1, Math.round(base * comboMult * pressureMult * superMult));
    this.score += value;
    this.popups.push({ x, y, age: 0, life: 0.9, text: `+${value}`, big: this.combo >= 8 });
    return value;
  }

  private fireShockwave(power: number, free: boolean): void {
    const p = clamp(power, 0, 1);
    const start = this.coreRadius();
    const maxRadius = 0.38 + p * 0.55 + (this.supernova > 0 ? 0.08 : 0);
    this.shockwaves.push({
      startRadius: start,
      radius: start,
      prevRadius: start,
      maxRadius,
      power: p,
      age: 0,
      duration: 0.55 + p * 0.35,
      hit: new Set(),
    });
    this.effects.push({
      kind: "shock",
      x: 0,
      y: 0,
      age: 0,
      life: 0.7 + p * 0.2,
      power: p,
      seed: Math.random() * 90,
    });
    this.shake = Math.max(this.shake, 0.18 + p * 0.45);
    this.events.push({ type: "shockwave", power: p });
    if (!free) {
      this.cooldown = 0.5;
      this.pressure = 0;
    }
  }

  private updateShockwaves(dt: number): void {
    const destroyed = new Set<number>();

    for (const ring of this.shockwaves) {
      ring.age += dt;
      ring.prevRadius = ring.radius;
      const t = clamp(ring.age / ring.duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      ring.radius = lerp(ring.startRadius, ring.maxRadius, eased);

      for (const entity of this.entities) {
        if (ring.hit.has(entity.id) || destroyed.has(entity.id)) continue;
        const d = Math.hypot(entity.x, entity.y);
        if (d + entity.r < ring.prevRadius || d - entity.r > ring.radius) continue;
        ring.hit.add(entity.id);

        if (entity.kind === "mote") {
          this.pushEntity(entity, ring.power);
          continue;
        }

        const canDestroy =
          entity.kind === "heavy"
            ? ring.power >= 0.55
            : entity.kind === "comet"
              ? ring.power >= 0.35
              : ring.power >= 0.12;

        if (!canDestroy) {
          this.pushEntity(entity, ring.power);
          continue;
        }

        destroyed.add(entity.id);
        this.stats.destroyed++;
        const perfect = d < 0.2;
        if (perfect) this.stats.perfect++;
        const base =
          entity.kind === "heavy" ? 60 : entity.kind === "comet" ? 100 : 25;
        this.award(base * (1 + ring.power * 0.5) + (perfect ? 40 : 0), entity.x, entity.y);
        if (perfect) {
          this.popups.push({
            x: entity.x,
            y: entity.y - 0.035,
            age: 0,
            life: 1.1,
            text: "PERFECT",
            big: true,
          });
        }
        this.effects.push({
          kind: "shatter",
          x: entity.x,
          y: entity.y,
          age: 0,
          life: 0.6,
          power: 0.8,
          seed: entity.seed,
        });
        this.events.push({ type: "shatter", power: ring.power, perfect });
      }
    }

    if (destroyed.size > 0) {
      this.entities = this.entities.filter((entity) => !destroyed.has(entity.id));
    }
    this.shockwaves = this.shockwaves.filter((ring) => ring.age < ring.duration);
  }

  private pushEntity(entity: GameEntity, power: number): void {
    const d = Math.max(0.03, Math.hypot(entity.x, entity.y));
    const speed = 0.9 + power * 1.6;
    entity.vx = (entity.x / d) * speed;
    entity.vy = (entity.y / d) * speed;
    entity.pushed = true;
    this.effects.push({
      kind: "miss",
      x: entity.x,
      y: entity.y,
      age: 0,
      life: 0.35,
      power: 0.4,
      seed: entity.seed,
    });
  }

  private updateWave(dt: number): void {
    this.waveTime += dt;
    const config = this.waveConfig;
    if (this.waveTime < config.duration) return;

    if (this.wave >= WAVES.length) {
      this.endGame(true);
      return;
    }

    this.score += 120 * this.wave;
    this.wave += 1;
    this.waveTime = 0;
    this.waveBanner = 1.6;
    this.spawnTimer = 0.8;
    this.entities = [];
    this.shockwaves = [];
    this.effects.push({ kind: "shock", x: 0, y: 0, age: 0, life: 1, power: 0.65, seed: 42 });
    this.events.push({ type: "wave", wave: this.wave });
  }

  private triggerSupernova(): void {
    this.mass = 0;
    this.supernova = 7;
    this.score += 300;
    this.pressure = 0;
    this.fireShockwave(1, true);
    this.flash = 1;
    this.shake = 1;
    this.effects.push({ kind: "supernova", x: 0, y: 0, age: 0, life: 1.4, power: 1, seed: 7 });
    this.events.push({ type: "supernova" });
  }

  private endGame(victory: boolean): void {
    if (this.phase === "over") return;
    this.phase = "over";
    this.wasClenched = false;

    let bonus = 0;
    if (victory) {
      bonus = 400 + this.lives * 200 + this.maxCombo * 10;
      this.score += bonus;
    }

    this.best = Math.max(this.best, this.score);
    const rank = RANKS.find((entry) => this.score >= entry.min)?.rank ?? RANKS[RANKS.length - 1].rank;
    this.results = {
      victory,
      score: this.score,
      best: this.best,
      bonus,
      wave: this.wave,
      lives: this.lives,
      maxCombo: this.maxCombo,
      absorbed: this.stats.absorbed,
      destroyed: this.stats.destroyed,
      rankCn: rank.cn,
      rankEn: rank.en,
    };
    this.events.push({ type: "gameover", victory });
  }

  private updateCosmetics(dt: number): void {
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter((effect) => effect.age < effect.life);
    for (const popup of this.popups) {
      popup.age += dt;
      popup.y -= dt * 0.045;
    }
    this.popups = this.popups.filter((popup) => popup.age < popup.life);
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  get progress(): number {
    return clamp(this.waveTime / this.waveConfig.duration, 0, 1);
  }
}
