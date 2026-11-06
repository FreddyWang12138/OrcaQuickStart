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
