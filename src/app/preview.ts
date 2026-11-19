import { getEngine } from "../tts/registry";
import { createPreviewer } from "../tts/preview";
import { audioCache } from "../tts/audioCache";
import type { EngineId, EngineStatus } from "../tts/types";
import { player, sink } from "./session";
import { getSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { toast } from "./toast";

const onStatus = (s: EngineStatus) => usePlayer.setState({ engineStatus: s });

const previewer = createPreviewer({
  sink,
  cache: audioCache,
  getEngine,
  settings: () => getSettings().tts,
  // The reader and previews share the audio clock: stop the reader so a preview can't resume it.
  onStart: () => {
    if (player.isActive) player.stop();
  },
  onStatus,
  onError: (e) => toast(e.message, "error", 7000),
  // On-device cloning is much slower per sentence (and learns the voice on first use).
  watchdogMs: (engine) => (engine === "chatterbox" ? 600_000 : 90_000),
});

// Starting the reader ends any preview.
player.on("state", (s) => {
  if (s === "loading" && previewer.active) previewer.stop();
});

/** Plays a short sample of a voice. Resolves once the first audio is scheduled. */
export function previewVoice(engineId: EngineId, voice: string, text?: string): Promise<void> {
  return previewer.play(engineId, voice, text);
}

/** Preview button behavior: start, or stop if this voice is already previewing. */
export function togglePreview(engineId: EngineId, voice: string): Promise<void> {
  return previewer.toggle(engineId, voice);
}

export function stopPreview(): void {
  previewer.stop();
}
