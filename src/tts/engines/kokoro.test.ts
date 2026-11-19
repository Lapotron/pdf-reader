import { describe, expect, it } from "vitest";
import { KokoroEngine, type WorkerLike } from "./kokoro";
import type { KIn, KOut } from "./kokoroProtocol";

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<KOut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  gens: Extract<KIn, { t: "gen" }>[] = [];
  postMessage(m: KIn): void {
    if (m.t === "init") queueMicrotask(() => this.send({ t: "ready", device: "wasm", dtype: "q8", voices: [] }));
    if (m.t === "gen") this.gens.push(m);
  }
  terminate(): void {}
  send(m: KOut): void {
    this.onmessage?.({ data: m } as MessageEvent<KOut>);
  }
  finish(id: number): void {
    this.send({ t: "audio", id, pcm: new Float32Array(2400), sr: 24000, ms: 5 });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const w = new FakeWorker();
  const e = new KokoroEngine(() => ({ device: "wasm", dtype: "q8" }), () => w);
  return { w, e };
}

describe("KokoroEngine request queue", () => {
  it("sends one job at a time, in priority order", async () => {
    const { w, e } = setup();
    const first = e.synthesize({ text: "first", voice: "af_heart", speed: 1, priority: 0 });
    await tick();
    const low = e.synthesize({ text: "low", voice: "af_heart", speed: 1, priority: 9 });
    const high = e.synthesize({ text: "high", voice: "af_heart", speed: 1, priority: 1 });
    await tick();
    expect(w.gens.map((g) => g.text)).toEqual(["first"]);
    w.finish(w.gens[0].id);
    await first;
    await tick();
    expect(w.gens.map((g) => g.text)).toEqual(["first", "high"]);
    w.finish(w.gens[1].id);
    await high;
    await tick();
    w.finish(w.gens[2].id);
    expect((await low).sampleRate).toBe(24000);
  });

  it("a cancelled queued job never reaches the worker; a cancelled in-flight job is dropped", async () => {
    const { w, e } = setup();
    const busy = new AbortController();
    const inflight = e.synthesize({ text: "busy", voice: "af_heart", speed: 1, signal: busy.signal });
    await tick();
    const stale = new AbortController();
    const queued = e.synthesize({ text: "stale", voice: "af_heart", speed: 1, signal: stale.signal });
    const next = e.synthesize({ text: "next", voice: "af_heart", speed: 1 });
    stale.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    busy.abort();
    await expect(inflight).rejects.toMatchObject({ name: "AbortError" }); // rejected right away
    w.finish(w.gens[0].id); // late result of the aborted job is ignored
    await tick();
    expect(w.gens.map((g) => g.text)).toEqual(["busy", "next"]);
    w.finish(w.gens[1].id);
    await expect(next).resolves.toMatchObject({ sampleRate: 24000 });
  });
});
