/**
 * Minimal procedural ambience. No external assets: filtered noise shaped per
 * biome, faded in only after a user gesture so browsers never block playback.
 */
export type AmbienceKind = "wind" | "ocean" | "forest" | "desert" | "none";

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private band: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private kind: AmbienceKind = "none";
  private volume = 0.45;
  private enabled = false;

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === "running" && this.enabled;
  }

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 620;
      filter.Q.value = 0.6;

      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 320;
      band.Q.value = 0.4;

      const gain = ctx.createGain();
      gain.gain.value = 0.5;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.16;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);

      source.connect(filter);
      filter.connect(band);
      band.connect(gain);
      gain.connect(master);
      source.start();
      lfo.start();

      this.ctx = ctx;
      this.master = master;
      this.source = source;
      this.filter = filter;
      this.band = band;
      this.gain = gain;
      this.lfo = lfo;
      this.lfoGain = lfoGain;
      return true;
    } catch {
      return false;
    }
  }

  setKind(kind: AmbienceKind): void {
    this.kind = kind;
    if (!this.ctx || !this.filter || !this.band || !this.gain || !this.lfo || !this.lfoGain) return;
    const now = this.ctx.currentTime;
    const params: Record<Exclude<AmbienceKind, "none">, { freq: number; band: number; q: number; level: number; lfo: number }> = {
      wind: { freq: 520, band: 420, q: 0.5, level: 0.5, lfo: 0.07 },
      ocean: { freq: 380, band: 220, q: 0.35, level: 0.72, lfo: 0.085 },
      forest: { freq: 1500, band: 900, q: 0.9, level: 0.34, lfo: 0.12 },
      desert: { freq: 900, band: 700, q: 0.6, level: 0.24, lfo: 0.05 },
    };
    if (kind === "none") {
      this.gain.gain.setTargetAtTime(0, now, 0.6);
      return;
    }
    const p = params[kind];
    this.filter.frequency.setTargetAtTime(p.freq, now, 1.2);
    this.band.frequency.setTargetAtTime(p.band, now, 1.2);
    this.band.Q.setTargetAtTime(p.q, now, 1.2);
    this.gain.gain.setTargetAtTime(p.level, now, 0.9);
    this.lfo.frequency.setTargetAtTime(p.lfo, now, 1.0);
    this.lfoGain.gain.setTargetAtTime(kind === "ocean" ? 0.22 : 0.1, now, 1.0);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (!this.ensure()) return;
      void this.ctx?.resume();
      this.applyVolume(1.4);
      this.setKind(this.kind);
    } else if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume(0.35);
  }

  private applyVolume(ramp = 0.6): void {
    if (!this.master || !this.ctx) return;
    const target = this.enabled ? this.volume * 0.22 : 0;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, ramp);
  }

  dispose(): void {
    try {
      this.source?.stop();
      this.lfo?.stop();
      void this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
  }
}

export const ambience = new Ambience();