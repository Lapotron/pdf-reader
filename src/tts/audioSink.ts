export interface ScheduledSound {
  stop(): void;
  ended: Promise<void>;
}

export interface AudioSink {
  /** Current audio clock (seconds). */
  readonly now: number;
  /** Output latency estimate (seconds). */
  readonly latency: number;
  readonly running: boolean;
  /** Creates/resumes the audio context. Must be called from a user gesture the first time. */
  ensureRunning(): Promise<void>;
  schedule(pcm: Float32Array, sampleRate: number, when: number, o?: { rate?: number }): ScheduledSound;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  setVolume(v: number, rampSeconds?: number): void;
}

/** Web Audio implementation. */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private volume = 1;

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get latency(): number {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  async ensureRunning(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  schedule(pcm: Float32Array, sampleRate: number, when: number, o: { rate?: number } = {}): ScheduledSound {
    const ctx = this.ctx;
    if (!ctx || !this.gain) throw new Error("Audio context not started");
    const buffer = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate);
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    src.connect(this.gain);
    let resolveEnded!: () => void;
    const ended = new Promise<void>((r) => (resolveEnded = r));
    src.onended = () => {
      src.disconnect();
      resolveEnded();
    };
    src.start(Math.max(when, ctx.currentTime));
    return {
      stop: () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      },
      ended,
    };
  }

  async suspend(): Promise<void> {
    if (this.ctx?.state === "running") await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume();
  }

  setVolume(v: number, rampSeconds = 0.05): void {
    this.volume = v;
    if (this.ctx && this.gain) {
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(v, t + Math.max(0.01, rampSeconds));
    }
  }
}
