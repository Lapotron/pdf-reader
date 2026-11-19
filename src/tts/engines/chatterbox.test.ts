import { describe, expect, it } from "vitest";
import { ChatterboxEngine, type ChatterboxWorkerLike } from "./chatterbox";
import type { CIn, COut } from "./chatterboxProtocol";

class FakeWorker implements ChatterboxWorkerLike {
  onmessage: ((e: MessageEvent<COut>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  gens: Extract<CIn, { t: "gen" }>[] = [];
  init: Extract<CIn, { t: "init" }> | null = null;
  postMessage(m: CIn): void {
    if (m.t === "init") {
      this.init = m;
      queueMicrotask(() => this.send({ t: "ready", device: "wasm" }));
    } else this.gens.push(m);
  }
  terminate(): void {}
  send(m: COut): void {
    this.onmessage?.({ data: m } as MessageEvent<COut>);
  }
  finish(id: number): void {
    this.send({ t: "audio", id, pcm: new Float32Array(4800), sr: 24000, ms: 5 });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ChatterboxEngine", () => {
  it("sends the reference once per voice and self-hosts ONNX Runtime", async () => {
    const w = new FakeWorker();
    let ex = 0.5;
    const refs: string[] = [];
    const e = new ChatterboxEngine(() => ({ exaggeration: ex }), () => w, async (id) => (refs.push(id), new Float32Array(24000)));
    e.setTempVoice("cv_a", new Float32Array(24000));
    const a1 = e.synthesize({ text: "One.", voice: "cv_a", speed: 1 });
    await tick();
    expect(w.init?.wasm).toMatch(/vendor\/ort4\/ort-wasm-simd-threaded\.asyncify\.wasm$/);
    expect(w.gens[0].ref?.length).toBe(24000);
    w.finish(w.gens[0].id);
    await a1;
    const a2 = e.synthesize({ text: "Two.", voice: "cv_a", speed: 1 });
    await tick();
    expect(w.gens[1].ref).toBeUndefined(); // the worker already has this speaker
    w.finish(w.gens[1].id);
    await a2;
    expect(refs).toEqual([]); // temp voice: no DB lookup
    const tag = e.modelTag();
    ex = 1;
    expect(e.modelTag()).not.toBe(tag); // cached audio is keyed by exaggeration
  });

  it("cancels queued requests without sending them", async () => {
    const w = new FakeWorker();
    const e = new ChatterboxEngine(() => ({ exaggeration: 0.5 }), () => w, async () => new Float32Array(10));
    e.setTempVoice("cv_a", new Float32Array(10));
    const first = e.synthesize({ text: "First.", voice: "cv_a", speed: 1 });
    await tick();
    const ctrl = new AbortController();
    const stale = e.synthesize({ text: "Stale.", voice: "cv_a", speed: 1, signal: ctrl.signal });
    ctrl.abort();
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    w.finish(w.gens[0].id);
    await first;
    await tick();
    expect(w.gens.map((g) => g.text)).toEqual(["First."]);
  });
});
