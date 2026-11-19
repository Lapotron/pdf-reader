import { getEngine } from "../tts/registry";
import { usePlayer } from "../state/player";
import { DEFAULT_VOICES, getSettings } from "../state/settings";
import type { TtsEngine } from "../tts/types";

/**
 * Downloads everything Kokoro needs for offline use: the model (cached by transformers.js),
 * the ONNX Runtime wasm (cached by the service worker) and the selected voice. Also asks the
 * browser to keep storage persistent.
 */
export async function prepareKokoroOffline(): Promise<void> {
  const e = getEngine("kokoro") as TtsEngine;
  await e.init((s) => usePlayer.setState({ engineStatus: s }));
  const voice = getSettings().tts.voices.kokoro ?? DEFAULT_VOICES.kokoro;
  await e.synthesize({ text: "Ready.", voice, speed: 1, priority: -1 });
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}
