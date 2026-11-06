import type { Calibration } from "./Calibration";
import type { Game, GameResults } from "./Game";

export interface GameUICallbacks {
  onSkipCalibration: () => void;
  onMouseGame: () => void;
  onReplay: () => void;
  onExit: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const RING_LENGTH = 2 * Math.PI * 66;
const format = (value: number) => Math.round(value).toLocaleString("en-US");

export class GameUI {
  private readonly hud = $("game-hud");
  private readonly scoreEl = $("gh-score");
  private readonly comboEl = $("gh-combo");
  private readonly waveEl = $("gh-wave");
  private readonly waveFill = $("gh-wave-fill");
  private readonly livesEl = $("gh-lives");
  private readonly massFill = $("gh-mass-fill");
  private readonly massPct = $("gh-mass-pct");
  private readonly signal = $("gh-signal");
  private readonly signalText = $("gh-signal-text");
  private readonly signalSub = $("gh-signal-sub");
  private readonly banner = $("gh-banner");
  private readonly supernovaEl = $("gh-supernova");

  private readonly calibrationPanel = $("calibration");
  private readonly calStep = $("cal-step");
  private readonly calTitle = $("cal-title");
  private readonly calHint = $("cal-hint");
  private readonly calRing: SVGCircleElement;
  private readonly calPct = $("cal-pct");

  private readonly countdown = $("countdown");
  private readonly countdownNum = $("countdown-num");
  private readonly countdownLabel = this.countdown.querySelector(".countdown-label") as HTMLElement;

  private readonly pausePanel = $("pause");
  private readonly resultsPanel = $("results");
  private readonly resultEyebrow = $("result-eyebrow");
  private readonly resultRank = $("result-rank");
  private readonly resultEn = $("result-en");
  private readonly resultScore = $("result-score");
  private readonly resultBest = $("result-best");
  private readonly resultStats = $("result-stats");

  private readonly lives: HTMLElement[] = [];
  private lastScore = -1;
  private lastCombo = -1;
  private lastWave = -1;
  private lastLives = -1;
  private lastMass = -1;
  private lastSupernova = false;
  private bannerTimer = 0;
  private countdownValue = "";
  private mouseMode = false;
  private comboPopTimer = 0;

  constructor(private readonly callbacks: GameUICallbacks) {
    const ring = document.getElementById("cal-ring");
    if (!(ring instanceof SVGCircleElement)) throw new Error("Missing #cal-ring");
    this.calRing = ring;
    for (let i = 0; i < 3; i++) {
      const life = document.createElement("i");
      life.className = "gh-life";
      this.livesEl.appendChild(life);
      this.lives.push(life);
    }
    this.calRing.style.strokeDasharray = `${RING_LENGTH}`;
    this.calRing.style.strokeDashoffset = `${RING_LENGTH}`;
    $("cal-skip").addEventListener("click", () => this.callbacks.onSkipCalibration());
    $("cal-mouse").addEventListener("click", () => this.callbacks.onMouseGame());
    $("result-replay").addEventListener("click", () => this.callbacks.onReplay());
    $("result-exit").addEventListener("click", () => this.callbacks.onExit());
    this.hideAll();
  }

  enterGame(): void {
    document.body.classList.add("is-game");
    this.hud.setAttribute("aria-hidden", "false");
    this.resetHud();
  }

  exitGame(): void {
    document.body.classList.remove("is-game", "is-mouse-game");
    this.hud.setAttribute("aria-hidden", "true");
    this.hideAll();
  }

  hideAll(): void {
    for (const panel of [this.calibrationPanel, this.countdown, this.pausePanel, this.resultsPanel]) {
      panel.classList.remove("is-visible");
    }
    this.banner.classList.remove("is-visible");
    this.supernovaEl.classList.remove("is-visible");
  }

  showCalibration(cal: Calibration): void {
    this.calibrationPanel.classList.add("is-visible");
    this.updateCalibration(cal, true);
  }

  updateCalibration(cal: Calibration, present: boolean): void {
    this.calStep.textContent = cal.stepLabel;
    this.calTitle.textContent = cal.title;
    this.calHint.textContent = present ? cal.hint : "未检测到手部 · 把手放进画面";
    const pct = Math.round(cal.progress * 100);
    this.calPct.textContent = `${pct}%`;
    this.calRing.style.strokeDashoffset = `${RING_LENGTH * (1 - cal.progress)}`;
    this.calibrationPanel.classList.toggle("is-waiting", !present);
  }

  hideCalibration(): void {
    this.calibrationPanel.classList.remove("is-visible");
  }

  showCountdown(text: string, label = "准备迎接星尘"): void {
    this.countdown.classList.add("is-visible");
    this.countdownLabel.textContent = label;
    if (text !== this.countdownValue) {
      this.countdownValue = text;
      this.countdownNum.textContent = text;
      this.countdownNum.classList.remove("is-tick");
      void this.countdownNum.offsetWidth;
      this.countdownNum.classList.add("is-tick");
    }
  }

  hideCountdown(): void {
    this.countdown.classList.remove("is-visible");
    this.countdownValue = "";
  }

  showPause(visible: boolean): void {
    this.pausePanel.classList.toggle("is-visible", visible);
  }

  clearBanner(): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.classList.remove("is-visible");
  }

  showBanner(text: string): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.classList.add("is-visible");
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.remove("is-visible");
    }, 1700);
  }

  showResults(results: GameResults): void {
    this.resultEyebrow.textContent = results.victory ? "RUN COMPLETE" : "SIGNAL COLLAPSED";
    this.resultRank.textContent = results.rankCn;
    this.resultEn.textContent = results.rankEn;
    this.resultScore.textContent = format(results.score);
    this.resultBest.textContent = format(results.best);
    const bonus = results.bonus > 0 ? ` · 通关奖励 +${format(results.bonus)}` : "";
    this.resultStats.textContent = `吸收 ${results.absorbed} · 击碎 ${results.destroyed} · 最高连击 ${results.maxCombo}${bonus}`;
    this.resultsPanel.classList.add("is-visible");
    this.pausePanel.classList.remove("is-visible");
  }

  hideResults(): void {
    this.resultsPanel.classList.remove("is-visible");
  }

  setMouseMode(mouse: boolean): void {
    this.mouseMode = mouse;
    document.body.classList.toggle("is-mouse-game", mouse);
  }

  update(game: Game, clenched: boolean): void {
    if (this.lastScore !== game.score) {
      this.scoreEl.textContent = format(game.score);
      this.lastScore = game.score;
    }

    const combo = game.combo;
    if (combo !== this.lastCombo) {
      this.comboEl.textContent = `×${combo > 0 ? combo : 1}`;
      this.comboEl.classList.toggle("is-visible", combo > 0);
      if (combo > this.lastCombo) {
        window.clearTimeout(this.comboPopTimer);
        this.comboEl.classList.remove("is-pop");
        void this.comboEl.offsetWidth;
        this.comboEl.classList.add("is-pop");
        this.comboPopTimer = window.setTimeout(() => this.comboEl.classList.remove("is-pop"), 280);
      }
      this.lastCombo = combo;
    }

    if (this.lastWave !== game.wave) {
      this.waveEl.textContent = String(game.wave).padStart(2, "0");
      this.lastWave = game.wave;
    }
    this.waveFill.style.transform = `scaleX(${Math.max(0.002, game.progress)})`;

    if (this.lastLives !== game.lives) {
      this.lives.forEach((life, index) => {
        life.classList.toggle("is-lost", index >= game.lives);
      });
      this.lastLives = game.lives;
    }

    const mass = Math.round(game.mass * 100);
    if (mass !== this.lastMass) {
      this.massPct.textContent = `${mass}%`;
      this.massFill.style.transform = `scaleX(${Math.max(0, game.mass)})`;
      this.lastMass = mass;
    }

    let text = "握拳 · 蓄力";
    let sub = "张掌释放冲击波";
    if (game.phase === "paused") {
      text = "信号中断";
      sub = "等待手部回到画面";
    } else if (game.supernova > 0) {
      text = "超新星 · 爆发";
      sub = "引力翻倍 · 分数 ×2";
    } else if (this.mouseMode) {
      text = clenched ? `按住 · 蓄力 ${Math.round(game.pressure * 100)}%` : "按住 · 引力";
      sub = clenched ? "松开释放冲击波" : "按住吸星尘，松手放波";
    } else if (clenched) {
      text = `握拳 · 蓄力 ${Math.round(game.pressure * 100)}%`;
      sub = "松开手掌释放冲击波";
    } else {
      text = "张掌 · 释放";
      sub = "握拳吸入星尘";
    }
    if (this.signalText.textContent !== text) this.signalText.textContent = text;
    if (this.signalSub.textContent !== sub) this.signalSub.textContent = sub;
    this.signal.classList.toggle("is-charged", clenched && game.pressure > 0.55);
    this.signal.classList.toggle("is-supernova", game.supernova > 0);

    const supernova = game.supernova > 0;
    if (supernova !== this.lastSupernova) {
      this.supernovaEl.classList.toggle("is-visible", supernova);
      this.lastSupernova = supernova;
    }
  }

  private resetHud(): void {
    this.lastScore = -1;
    this.lastCombo = -1;
    this.lastWave = -1;
    this.lastLives = -1;
    this.lastMass = -1;
    this.lastSupernova = false;
    this.comboEl.classList.remove("is-visible", "is-pop");
    this.supernovaEl.classList.remove("is-visible");
    this.waveFill.style.transform = "scaleX(0.002)";
    this.massFill.style.transform = "scaleX(0)";
    this.signal.classList.remove("is-charged", "is-supernova");
  }
}
