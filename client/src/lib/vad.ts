/**
 * Web Audio Voice Activity Detection (VAD) with smooth hysteresis.
 * Runs locally on the user's microphone MediaStream so speaking indicators
 * feel instant and never flicker between syllables.
 */

export interface VadOptions {
  /** RMS level (0..1) required to enter speaking state */
  startThreshold?: number;
  /** RMS level (0..1) below which speaking ends after holdMs */
  stopThreshold?: number;
  /** Hold time in ms before dropping speaking=false to avoid choppy flickering */
  holdMs?: number;
  /** Poll interval in ms */
  pollIntervalMs?: number;
  /** Callback invoked only when speaking boolean transitions */
  onSpeakingChange: (speaking: boolean) => void;
  /** Optional smoothed audio level callback (0..1) for live mic meters */
  onLevel?: (level: number) => void;
}

export class VoiceActivityDetector {
  private audioCtx: AudioContext;
  private ownsContext: boolean;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomainData: Float32Array<ArrayBuffer> | null = null;
  private byteDomainData: Uint8Array<ArrayBuffer> | null = null;
  private timerId: number | null = null;

  private speaking = false;
  private muted = false;
  private lastAboveStopAt = 0;
  private smoothedLevel = 0;

  private readonly startThreshold: number;
  private readonly stopThreshold: number;
  private readonly holdMs: number;
  private readonly pollIntervalMs: number;
  private readonly onSpeakingChange: (speaking: boolean) => void;
  private readonly onLevel?: (level: number) => void;

  constructor(stream: MediaStream, opts: VadOptions, sharedAudioCtx?: AudioContext) {
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.audioCtx = sharedAudioCtx ?? new AudioCtxCtor();
    this.ownsContext = !sharedAudioCtx;

    this.startThreshold = opts.startThreshold ?? 0.032;
    this.stopThreshold = opts.stopThreshold ?? 0.018;
    this.holdMs = opts.holdMs ?? 320;
    this.pollIntervalMs = opts.pollIntervalMs ?? 85;
    this.onSpeakingChange = opts.onSpeakingChange;
    this.onLevel = opts.onLevel;

    try {
      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.35;
      this.source.connect(this.analyser);

      this.timeDomainData = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.byteDomainData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

      this.timerId = window.setInterval(() => this.sample(), this.pollIntervalMs);
    } catch (err) {
      console.warn('[VAD] Could not initialize AnalyserNode:', err);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.smoothedLevel = 0;
      this.onLevel?.(0);
      if (this.speaking) {
        this.speaking = false;
        this.onSpeakingChange(false);
      }
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  private sample(): void {
    if (!this.analyser) return;
    if (this.muted) {
      if (this.speaking) {
        this.speaking = false;
        this.onSpeakingChange(false);
      }
      return;
    }

    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }

    let rms = 0;
    if (this.analyser.getFloatTimeDomainData && this.timeDomainData) {
      this.analyser.getFloatTimeDomainData(this.timeDomainData);
      let sumSq = 0;
      for (let i = 0; i < this.timeDomainData.length; i++) {
        const v = this.timeDomainData[i];
        sumSq += v * v;
      }
      rms = Math.sqrt(sumSq / this.timeDomainData.length);
    } else if (this.byteDomainData) {
      this.analyser.getByteTimeDomainData(this.byteDomainData);
      let sumSq = 0;
      for (let i = 0; i < this.byteDomainData.length; i++) {
        const v = (this.byteDomainData[i] - 128) / 128;
        sumSq += v * v;
      }
      rms = Math.sqrt(sumSq / this.byteDomainData.length);
    }

    // Smooth visual level (boosted slightly so normal speech fills 0.2..0.9)
    const normalized = Math.min(1, rms * 4.5);
    this.smoothedLevel = this.smoothedLevel * 0.55 + normalized * 0.45;
    this.onLevel?.(this.smoothedLevel);

    const now = performance.now();
    if (!this.speaking) {
      if (rms >= this.startThreshold) {
        this.speaking = true;
        this.lastAboveStopAt = now;
        this.onSpeakingChange(true);
      }
    } else {
      if (rms >= this.stopThreshold) {
        this.lastAboveStopAt = now;
      } else if (now - this.lastAboveStopAt >= this.holdMs) {
        this.speaking = false;
        this.onSpeakingChange(false);
      }
    }
  }

  destroy(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      // Ignore
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // Ignore
    }
    this.source = null;
    this.analyser = null;
    if (this.speaking) {
      this.speaking = false;
      this.onSpeakingChange(false);
    }
    if (this.ownsContext && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
    }
  }
}
