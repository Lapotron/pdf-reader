import { getEngine } from "../tts/registry";
import { isLive, type EngineId } from "../tts/types";
import { player, sink } from "./session";
import { getSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import type { ScheduledSound } from "../tts/audioSink";

let current: ScheduledSound | null = null;
let seq = 0;

/** Plays a short sample of a voice (pauses the reader first). */
export async function previewVoice(engineId: EngineId, voice: string, text = getSettings().tts.previewText): Promise<void> {
  const id = ++seq;
  // Pausing suspends the shared audio clock; stop the reader so the preview can't resume it.
  if (player.isActive) player.stop();
  current?.stop();
  current = null;
  const e = getEngine(engineId);
  const running = sink.ensureRunning().catch(() => {}); // inside the click gesture
  await e.init((s) => usePlayer.setState({ engineStatus: s }));
  const t = getSettings().tts;
  if (isLive(e)) {
    e.speak(text, { voice, rate: t.speed, pitch: t.pitch, volume: t.volume }, { onWord() {}, onEnd() {}, onError() {} });
    return;
  }
  await running;
  await sink.resume();
  const [lo, hi] = e.caps.speedRange;
  const r = await e.synthesize({ text, voice, speed: Math.min(hi, Math.max(lo, t.speed)), priority: -1 });
  if (id !== seq) return;
  sink.setVolume(t.volume, 0.01);
  current = sink.schedule(r.pcm, r.sampleRate, sink.now + 0.05);
}

export function stopPreview(): void {
  seq++;
  current?.stop();
  current = null;
}
