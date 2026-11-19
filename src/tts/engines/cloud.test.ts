import { describe, expect, it, vi, afterEach } from "vitest";
import { buildSsml, escapeWithMap } from "./azure";
import { ElevenLabsEngine, elevenAlignmentToTimings } from "./elevenlabs";
import { OpenAIEngine } from "./openai";

afterEach(() => vi.unstubAllGlobals());

describe("cloud engines", () => {
  it("OpenAI decodes 24 kHz s16le PCM and sends the key", async () => {
    const pcm = new Int16Array([0, 16384, -32768]);
    const fetchMock = vi.fn(async () => new Response(pcm.buffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const e = new OpenAIEngine(() => ({ apiKey: "sk-test", model: "gpt-4o-mini-tts", baseUrl: "https://api.openai.com", instructions: "calm" }));
    const r = await e.synthesize({ text: "Hi", voice: "alloy", speed: 1.2 });
    expect(r.sampleRate).toBe(24000);
    expect(Array.from(r.pcm)).toEqual([0, 0.5, -1]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ response_format: "pcm", instructions: "calm" });
    // gpt-4o-mini-tts ignores speed: not sent, and the player time-stretches instead.
    expect(body.speed).toBeUndefined();
    expect(e.caps.speedRange).toEqual([1, 1]);
  });

  it("OpenAI tts-1 sends native speed", async () => {
    const fetchMock = vi.fn(async () => new Response(new Int16Array([0]).buffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const e = new OpenAIEngine(() => ({ apiKey: "k", model: "tts-1", baseUrl: "https://api.openai.com" }));
    await e.synthesize({ text: "Hi", voice: "alloy", speed: 1.5 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).speed).toBe(1.5);
  });

  it("OpenAI surfaces API error messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 })));
    const e = new OpenAIEngine(() => ({ apiKey: "bad", model: "tts-1", baseUrl: "https://api.openai.com" }));
    await expect(e.synthesize({ text: "Hi", voice: "alloy", speed: 1 })).rejects.toThrow(/401: Invalid key/);
  });

  it("ElevenLabs maps character alignment to word timings", async () => {
    const text = "Hi there";
    const chars = text.split("");
    const starts = chars.map((_, i) => i * 0.1);
    const ends = starts.map((s) => s + 0.1);
    const pcm = new Int16Array([1000, -1000]);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ audio_base64: b64, alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } }))),
    );
    const e = new ElevenLabsEngine(() => ({ apiKey: "k", model: "eleven_multilingual_v2", stability: 0.5, similarity: 0.75 }));
    const r = await e.synthesize({ text, voice: "v1", speed: 1 });
    expect(r.timingSource).toBe("engine");
    expect(r.timings).toEqual(elevenAlignmentToTimings(text, chars, starts, ends));
    expect(r.timings![1]).toMatchObject({ charStart: 3, charEnd: 8, start: 0.30000000000000004 });
  });

  it("Azure SSML escaping maps offsets back to the source text", () => {
    const { escaped, srcIndex } = escapeWithMap("A & B");
    expect(escaped).toBe("A &amp; B");
    expect(srcIndex[escaped.indexOf("B")]).toBe(4);
    const { ssml, prefixLen } = buildSsml("Fish & chips", "en-GB-SoniaNeural", 1.25);
    expect(ssml).toContain('xml:lang="en-GB"');
    expect(ssml).toContain('rate="+25%"');
    expect(ssml.slice(prefixLen, prefixLen + 4)).toBe("Fish");
  });
});
