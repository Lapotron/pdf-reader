import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/schema";
import { AudioCache } from "./audioCache";
import type { AudioSink, ScheduledSound } from "./audioSink";
import { MockEngine } from "./engines/mock";
import { createPreviewer, usePreview } from "./preview";
import type { SynthesisRequest, SynthesisResult } from "./types";

class FakeSink implements AudioSink {
  now = 0;
  latency = 0;
  running = true;
  scheduled: { pcm: Float32Array; stopped: boolean; end: () => void }[] = [];
  async ensureRunning() {}
  async suspend() {}
  async resume() {}
  setVolume() {}
  schedule(pcm: Float32Array): ScheduledSound {
    let end!: () => void;
    const ended = new Promise<void>((r) => (end = r));
    const entry = { pcm, stopped: false, end };
    this.scheduled.push(entry);
    return {
      stop: () => {
        entry.stopped = true;
        end();
      },
      ended,
    };
  }
}

/** Engine whose requests stay pending until released; records abort signals. */
class DeferredEngine extends MockEngine {
  requests: { req: SynthesisRequest; release: () => void }[] = [];
  override async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    await new Promise<void>((resolve, reject) => {
      this.requests.push({ req, release: resolve });
      req.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
    });
    return super.synthesize(req);
  }
}

const settings = () => ({ speed: 1, pitch: 1, volume: 1, previewText: "Hi there. This is a test." });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await tick();
  }
}

describe("voice previews", () => {
  beforeEach(async () => {
    await db.audioCache.clear();
    await db.meta.clear();
    usePreview.setState({ target: null, phase: null });
  });

  it("a new preview aborts the previous one so requests never pile up", async () => {
    const engine = new DeferredEngine(0);
    const sink = new FakeSink();
    const p = createPreviewer({ sink, cache: null, getEngine: () => engine, settings });
    void p.play("mock", "tone-a");
    await until(() => engine.requests.length === 1);
    void p.play("mock", "tone-b");
    await until(() => engine.requests.length === 2);
    expect(engine.requests[0].req.signal?.aborted).toBe(true);
    expect(usePreview.getState()).toEqual({ target: "mock:tone-b", phase: "preparing" });
    engine.requests[1].release();
    await until(() => sink.scheduled.length === 1);
    expect(usePreview.getState().phase).toBe("playing");
    // Plays sentence by sentence: the second sentence is requested after the first is scheduled.
    await until(() => engine.requests.length === 3);
    expect(engine.requests[2].req.text).toBe("This is a test.");
    expect(engine.requests[2].req.voice).toBe("tone-b");
  });

  it("stop() stops the sound and clears the state", async () => {
    const sink = new FakeSink();
    const p = createPreviewer({ sink, cache: null, getEngine: () => new MockEngine(0), settings });
    await p.play("mock", "tone-a");
    await until(() => sink.scheduled.length >= 1);
    p.stop();
    expect(sink.scheduled.every((s) => s.stopped)).toBe(true);
    expect(usePreview.getState()).toEqual({ target: null, phase: null });
  });

  it("toggle on the active voice stops it; the state clears when playback ends", async () => {
    const sink = new FakeSink();
    const p = createPreviewer({ sink, cache: null, getEngine: () => new MockEngine(0), settings });
    void p.toggle("mock", "tone-a");
    await until(() => sink.scheduled.length === 2);
    sink.scheduled[1].end(); // last piece finished
    await until(() => usePreview.getState().target === null);
    void p.toggle("mock", "tone-a");
    await until(() => usePreview.getState().phase === "playing");
    await p.toggle("mock", "tone-a");
    expect(usePreview.getState().target).toBeNull();
  });

  it("replaying the same preview comes from the cache", async () => {
    const engine = new MockEngine(0);
    const sink = new FakeSink();
    const p = createPreviewer({ sink, cache: new AudioCache(), getEngine: () => engine, settings });
    await p.play("mock", "tone-a");
    await until(() => sink.scheduled.length === 2);
    let stored = 0;
    await until(() => {
      void db.audioCache.count().then((n) => (stored = n));
      return stored === 2;
    });
    const calls = engine.calls;
    p.stop();
    await p.play("mock", "tone-a");
    await until(() => sink.scheduled.length === 4);
    expect(engine.calls).toBe(calls);
  });

  it("the watchdog resets a preview that never produces audio", async () => {
    const engine = new DeferredEngine(0);
    const errors: Error[] = [];
    const p = createPreviewer({ sink: new FakeSink(), cache: null, getEngine: () => engine, settings, watchdogMs: 30, onError: (e) => errors.push(e) });
    void p.play("mock", "tone-a");
    await until(() => errors.length === 1, 1000);
    expect(usePreview.getState().target).toBeNull();
    expect(engine.requests[0].req.signal?.aborted).toBe(true);
  });
});
