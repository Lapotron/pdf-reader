import type { EngineStatus, LiveTtsEngine, VoiceInfo } from "../types";

/** Browser speechSynthesis — last-resort fallback (no export/caching). */
export class WebSpeechEngine implements LiveTtsEngine {
  readonly id = "webspeech" as const;
  readonly label = "Browser voices (fallback)";
  readonly live = true as const;
  readonly caps = { wordTimings: true, speedRange: [0.5, 3] as [number, number], offline: true, maxChars: 4000, concurrency: 1, needsKey: false };
  private utter: SpeechSynthesisUtterance | null = null;

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  async init(onStatus: (s: EngineStatus) => void): Promise<void> {
    if (!this.supported) {
      onStatus({ state: "error", error: "speechSynthesis is not supported in this browser" });
      throw new Error("speechSynthesis is not supported in this browser");
    }
    onStatus({ state: "ready", device: "browser" });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.supported) return [];
    const get = () => speechSynthesis.getVoices();
    let voices = get();
    if (!voices.length) {
      await new Promise<void>((r) => {
        const t = setTimeout(r, 1000);
        speechSynthesis.addEventListener("voiceschanged", () => (clearTimeout(t), r()), { once: true });
      });
      voices = get();
    }
    return voices.map((v) => ({ id: v.voiceURI, name: `${v.name}${v.localService ? "" : " (online)"}`, lang: v.lang, engine: "webspeech" as const }));
  }

  speak(
    text: string,
    o: { voice: string; rate: number; pitch: number; volume: number },
    cb: { onWord(charIndex: number, charLength: number): void; onEnd(): void; onError(e: unknown): void },
  ): void {
    this.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === o.voice);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = Math.min(3, Math.max(0.5, o.rate));
    u.pitch = o.pitch;
    u.volume = o.volume;
    u.onboundary = (e) => {
      if (e.name === "word" || e.name === undefined) cb.onWord(e.charIndex, e.charLength ?? 0);
    };
    u.onend = () => {
      if (this.utter === u) {
        this.utter = null;
        cb.onEnd();
      }
    };
    u.onerror = (e) => {
      if (this.utter !== u) return;
      this.utter = null;
      if (e.error === "interrupted" || e.error === "canceled") return;
      cb.onError(new Error(`Speech error: ${e.error}`));
    };
    this.utter = u;
    speechSynthesis.speak(u);
  }

  pause(): void {
    if (this.supported) speechSynthesis.pause();
  }

  resume(): void {
    if (this.supported) speechSynthesis.resume();
  }

  cancel(): void {
    this.utter = null;
    if (this.supported) speechSynthesis.cancel();
  }

  dispose(): void {
    this.cancel();
  }
}
