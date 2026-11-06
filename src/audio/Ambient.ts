/**
 * A tiny generative ambient layer: low detuned drone, filtered air and a sub
 * that responds to the nebula state. No assets, everything is synthesised.
 */
export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private subGain: GainNode | null = null;
  private oscB: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private muted = false;
  private lastExpand = 0.5;
  private lastTransition = 0;

  get isStarted(): boolean {
    return this.started;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  async start(): Promise<void> {
    if (this.started) {
      await this.ctx?.resume().catch(() => undefined);
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      await ctx.resume();

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      const reverb = ctx.createConvolver();
      reverb.buffer = this.makeImpulse(ctx, 2.8, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      reverb.connect(wet);
      wet.connect(master);
      this.reverb = reverb;

      // ---- drone ----------------------------------------------------------
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 420;
      padFilter.Q.value = 1.2;
      this.padFilter = padFilter;

      const padGain = ctx.createGain();
      padGain.gain.value = 0.05;
      padGain.connect(master);
      padGain.connect(reverb);
      padFilter.connect(padGain);
      this.padGain = padGain;

      const voices: Array<[number, OscillatorType, number]> = [
        [55, "sine", 0.42],
        [82.407, "sine", 0.2],
        [110, "triangle", 0.08],
        [164.814, "sine", 0.05],
      ];
      for (const [frequency, type, level] of voices) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = frequency;
        const gain = ctx.createGain();
        gain.gain.value = level;
        osc.connect(gain);
        gain.connect(padFilter);
        osc.start();
        if (frequency === 82.407) this.oscB = osc;
      }

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.055;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 110;
      lfo.connect(lfoGain);
      lfoGain.connect(padFilter.frequency);
      lfo.start();

      // ---- air ------------------------------------------------------------
      const noiseBuffer = this.makeNoise(ctx, 4);
      this.noiseBuffer = noiseBuffer;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 900;
      band.Q.value = 0.55;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.012;
      noise.connect(band);
      band.connect(noiseGain);
      noiseGain.connect(master);
      noiseGain.connect(reverb);
      noise.start();
      this.noiseGain = noiseGain;

      // ---- sub ------------------------------------------------------------
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = 41.2;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.12;
      sub.connect(subGain);
      subGain.connect(master);
      sub.start();
      this.subGain = subGain;

      this.started = true;
      master.gain.setTargetAtTime(0.5, ctx.currentTime, 1.4);
    } catch (error) {
      console.warn("[audio] unavailable", error);
      this.ctx = null;
    }
  }

  update(expand: number, energy: number): void {
    if (!this.started || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const smooth = (param: AudioParam, value: number, tau = 0.14) => {
      param.setTargetAtTime(value, now, tau);
    };

    if (this.padFilter) smooth(this.padFilter.frequency, 320 + 1500 * expand, 0.25);
    if (this.padGain) smooth(this.padGain.gain, 0.045 + 0.045 * expand);
    if (this.noiseGain) smooth(this.noiseGain.gain, 0.008 + 0.028 * expand + energy * 0.012);
    if (this.subGain) smooth(this.subGain.gain, 0.09 + 0.05 * (1 - expand) + energy * 0.03);
    if (this.oscB) smooth(this.oscB.detune, (expand - 0.5) * 26, 0.3);

    if (this.lastExpand > 0.58 && expand < 0.24 && now - this.lastTransition > 1.4) {
      this.thump();
      this.lastTransition = now;
    } else if (this.lastExpand < 0.22 && expand > 0.62 && now - this.lastTransition > 1.4) {
      this.swell();
      this.lastTransition = now;
    }
    this.lastExpand = expand;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.25);
    }
    return this.muted;
  }

  async suspend(): Promise<void> {
    await this.ctx?.suspend().catch(() => undefined);
  }

  async resume(): Promise<void> {
    if (this.started && !this.muted) {
      await this.ctx?.resume().catch(() => undefined);
    }
  }

  /** Short bright chime when a mote is swallowed. */
  absorb(value: number): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const freq = 540 + Math.min(420, Math.max(0, value) * 3.5);
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.16, now + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.032, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /** Crackle plus a little body when a void shard is destroyed. */
  shatter(power: number, perfect: boolean): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 700 + power * 1400;
    const gain = ctx.createGain();
    const level = 0.045 + power * 0.05 + (perfect ? 0.025 : 0);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    source.start(now);
    source.stop(now + 0.28);

    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(170, now);
    body.frequency.exponentialRampToValueAtTime(58, now + 0.2);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.035, now + 0.01);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    body.connect(bodyGain);
    bodyGain.connect(this.master);
    body.start(now);
    body.stop(now + 0.3);
  }

  /** The exhale: a rushing wave with a sub hit. */
  shock(power: number): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const p = Math.min(1, Math.max(0, power));

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04 + p * 0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    source.start(now);
    source.stop(now + 0.7);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(78, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.55);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.07 + p * 0.1, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    sub.connect(subGain);
    subGain.connect(this.master);
    if (this.reverb) subGain.connect(this.reverb);
    sub.start(now);
    sub.stop(now + 0.72);
  }

  damage(): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  wave(): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      const start = now + index * 0.085;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.025, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain);
      gain.connect(this.master!);
      if (this.reverb) gain.connect(this.reverb);
      osc.start(start);
      osc.stop(start + 0.52);
    });
  }

  supernova(): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 1.45);

    for (const [frequency, level] of [
      [440, 0.03],
      [660, 0.02],
      [880, 0.014],
    ]) {
      const tone = ctx.createOscillator();
      tone.type = "triangle";
      tone.frequency.value = frequency;
      const toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(level, now + 0.15);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
      tone.connect(toneGain);
      toneGain.connect(this.master);
      if (this.reverb) toneGain.connect(this.reverb);
      tone.start(now);
      tone.stop(now + 1.65);
    }
  }

  tick(final = false): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = final ? 880 : 520;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(final ? 0.022 : 0.012, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  gameOver(victory: boolean): void {
    const ctx = this.sfxContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const notes = victory ? [392, 523.25, 659.25, 783.99] : [349.23, 293.66, 233.08];
    notes.forEach((frequency, index) => {
      const start = now + index * 0.16;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.03, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
      osc.connect(gain);
      gain.connect(this.master!);
      if (this.reverb) gain.connect(this.reverb);
      osc.start(start);
      osc.stop(start + 0.85);
    });
  }

  private sfxContext(): AudioContext | null {
    if (!this.started || !this.ctx || !this.master || this.muted) return null;
    return this.ctx;
  }

  private thump(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 1.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  private swell(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 1.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    if (this.reverb) gain.connect(this.reverb);
    source.start(now);
    source.stop(now + 1.9);
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 64 ? i / 64 : 1);
      }
    }
    return buffer;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 4 + white * 0.25;
    }
    return buffer;
  }
}
