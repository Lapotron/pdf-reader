import { getSettings } from "../state/settings";
import { useKeys } from "../state/keys";
import { usePlayer } from "../state/player";
import { AzureEngine } from "./engines/azure";
import { ElevenLabsEngine } from "./engines/elevenlabs";
import { KokoroEngine } from "./engines/kokoro";
import { MockEngine } from "./engines/mock";
import { OpenAIEngine } from "./engines/openai";
import { WebSpeechEngine } from "./engines/webspeech";
import type { AnyEngine, EngineId, EngineStatus } from "./types";

export interface EngineInfo {
  id: EngineId;
  label: string;
  description: string;
  badges: string[];
}

export const ENGINE_INFO: EngineInfo[] = [
  { id: "kokoro", label: "Kokoro (local neural)", description: "Natural voices generated on your device. Free, private, works offline after a one-time model download.", badges: ["Free", "Private", "Offline"] },
  { id: "openai", label: "OpenAI", description: "High-quality cloud voices using your OpenAI API key. Also works with any OpenAI-compatible speech server.", badges: ["API key", "Cloud"] },
  { id: "elevenlabs", label: "ElevenLabs", description: "Premium expressive cloud voices with exact word timing, using your ElevenLabs API key.", badges: ["API key", "Cloud", "Exact words"] },
  { id: "azure", label: "Azure Neural", description: "Microsoft neural voices with exact word timing, using your Azure Speech key and region.", badges: ["API key", "Cloud", "Exact words"] },
  { id: "webspeech", label: "Browser voices", description: "Built-in system voices. Lowest quality; no export. Used as a fallback.", badges: ["Fallback"] },
];

const engines: Partial<Record<EngineId, AnyEngine>> = {};

export function getEngine(id: EngineId): AnyEngine {
  let e = engines[id];
  if (e) return e;
  switch (id) {
    case "kokoro":
      e = new KokoroEngine(() => ({ device: getSettings().tts.kokoroDevice, dtype: getSettings().tts.kokoroDtype }));
      break;
    case "openai":
      e = new OpenAIEngine(() => {
        const t = getSettings().tts;
        return { apiKey: useKeys.getState().openai, model: t.openaiModel, baseUrl: t.openaiBaseUrl || "https://api.openai.com", instructions: t.openaiInstructions };
      });
      break;
    case "elevenlabs":
      e = new ElevenLabsEngine(() => {
        const t = getSettings().tts;
        return { apiKey: useKeys.getState().elevenlabs, model: t.elevenModel, stability: t.elevenStability, similarity: t.elevenSimilarity };
      });
      break;
    case "azure":
      e = new AzureEngine(() => ({ apiKey: useKeys.getState().azure, region: getSettings().tts.azureRegion }));
      break;
    case "webspeech":
      e = new WebSpeechEngine();
      break;
    case "mock": {
      const scale = Number(new URLSearchParams(location.search).get("mockspeed") ?? "1");
      e = new MockEngine(20, Number.isFinite(scale) && scale > 0 ? scale : 1);
      break;
    }
  }
  engines[id] = e;
  return e;
}

/** URL override for tests/demos: ?engine=mock */
export function engineOverride(): EngineId | null {
  try {
    const v = new URLSearchParams(location.search).get("engine");
    return v && ["kokoro", "openai", "elevenlabs", "azure", "webspeech", "mock"].includes(v) ? (v as EngineId) : null;
  } catch {
    return null;
  }
}

export function selectedEngineId(): EngineId {
  return engineOverride() ?? getSettings().tts.engine;
}

const onStatus = (s: EngineStatus) => usePlayer.setState({ engineStatus: s });

/** Resolves and initializes the engine to use, falling back to browser voices if allowed. */
export async function activeEngine(): Promise<AnyEngine> {
  const id = selectedEngineId();
  const e = getEngine(id);
  try {
    await e.init(onStatus);
    usePlayer.setState({ activeEngine: id });
    return e;
  } catch (err) {
    if (!getSettings().tts.fallback || id === "webspeech" || id === "mock") throw err;
    const w = getEngine("webspeech");
    await w.init(onStatus);
    usePlayer.setState({ activeEngine: "webspeech", notice: `${e.label} is unavailable (${(err as Error).message}). Using browser voices for now.` });
    return w;
  }
}

/** Disposes engines whose configuration changed (e.g. Kokoro device/precision). */
export function resetEngine(id: EngineId): void {
  engines[id]?.dispose();
  delete engines[id];
  if (usePlayer.getState().activeEngine === id) usePlayer.setState({ engineStatus: { state: "idle" } });
}
