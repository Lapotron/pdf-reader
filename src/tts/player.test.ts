import { describe, expect, it, beforeEach } from "vitest";
import { MappedString } from "../text/mappedString";
import { ReadingModel, type PageTextProvider } from "../text/readingModel";
import { DEFAULT_CLEANUP } from "../text/cleanup";
import { buildPageText } from "../pdf/layout";
import type { PItem } from "../pdf/types";
import { srcPos } from "../pdf/types";
import { AudioCache } from "./audioCache";
import type { AudioSink, ScheduledSound } from "./audioSink";
import { MockEngine } from "./engines/mock";
import { Player, alignTimings, type PlaybackPrefs, type PlayerState } from "./player";
import { db } from "../db/schema";

/** Manual-clock audio sink. */
class FakeSink implements AudioSink {
  now = 0;
  latency = 0;
  running = false;
  scheduled: { when: number; end: number; resolve: () => void; stopped: boolean; done: boolean; rate: number }[] = [];
  async ensureRunning() {
    this.running = true;
  }
  schedule(pcm: Float32Array, sr: number, when: number, o: { rate?: number } = {}): ScheduledSound {
    let resolve!: () => void;
    const ended = new Promise<void>((r) => (resolve = r));
    const rate = o.rate ?? 1;
    const entry = { when, end: when + pcm.length / sr / rate, resolve, stopped: false, done: false, rate };
    this.scheduled.push(entry);
    return {
      stop: () => {
        if (!entry.done) {
          entry.stopped = true;
          entry.done = true;
          resolve();
        }
      },
      ended,
    };
  }
  async suspend() {
    this.running = false;
  }
  async resume() {
    this.running = true;
  }
  setVolume() {}
  /** Advances the clock, firing `ended` for finished sounds. */
  async advance(dt: number) {
    const target = this.now + dt;
    while (this.now < target) {
      this.now = Math.min(target, this.now + 0.05);
      for (const s of this.scheduled) if (!s.done && s.end <= this.now) {
        s.done = true;
        s.resolve();
      }
      await flush();
    }
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function waitFor(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await flush();
  }
}

/** One page, plain left-aligned lines, synthetic items. */
function provider(lines: string[][]): PageTextProvider {
  const pages = lines.map((pageLines, pi) => {
    const items: PItem[] = pageLines.map((str, i) => ({
      str,
      rect: { x: 72, y: 100 + i * 16, w: str.length * 6, h: 14 },
      baseline: 111 + i * 16,
      fontSize: 12,
      fontFamily: "sans-serif",
      angle: 0,
      hasEOL: true,
      raw: i,
    }));
    return buildPageText(pi + 1, 612, 792, items);
  });
  return { numPages: pages.length, getPageText: async (p) => pages[p - 1], peekPageText: (p) => pages[p - 1] };
}

const prefs: PlaybackPrefs = {
  voice: "tone-a",
  speed: 1,
  pitch: 1,
  volume: 1,
  pauseSentence: 0.1,
  pauseParagraph: 0.3,
  prefetchSeconds: 5,
  prefetchChunks: 2,
  trimSilence: false,
  normalize: false,
};

describe("Player", () => {
  let sink: FakeSink;
  let engine: MockEngine;
  let player: Player;
  let states: PlayerState[];

  beforeEach(async () => {
    await db.audioCache.clear();
    sink = new FakeSink();
    engine = new MockEngine(0);
    const model = new ReadingModel(
      provider([
        ["First sentence here. Second one", "follows now. Third is short."],
        ["Page two starts. It ends here."],
      ]),
      DEFAULT_CLEANUP,
    );
    player = new Player({ sink, cache: new AudioCache(), getEngine: async () => engine, prefs: () => prefs });
    player.setModel(model);
    states = [];
    player.on("state", (s) => states.push(s));
  });

  it("plays sentences gaplessly in order and reports positions", async () => {
    const seen: string[] = [];
    player.on("position", (p) => {
      if (p && seen[seen.length - 1] !== p.sentence.text) seen.push(p.sentence.text);
    });
    await player.play();
    for (let k = 0; k < 400 && player.state !== "idle"; k++) {
      await sink.advance(0.1);
      player.tick();
    }
    expect(seen).toEqual(["First sentence here.", "Second one follows now.", "Third is short.", "Page two starts.", "It ends here."]);
    expect(states).toContain("playing");
    expect(states[states.length - 1]).toBe("idle");
    // Scheduled back-to-back: each starts at or after the previous end (plus pause), no overlap.
    for (let i = 1; i < sink.scheduled.length; i++) expect(sink.scheduled[i].when).toBeGreaterThanOrEqual(sink.scheduled[i - 1].end - 1e-9);
    expect(sink.scheduled).toHaveLength(5);
  });

  it("starts from a clicked word mid-sentence", async () => {
    const pt = await player.readingModel!.page(1);
    const local = pt.source.indexOf("one");
    await player.play(srcPos(1, local));
    await sink.advance(0.05);
    player.tick();
    expect(player.position?.sentence.text).toBe("Second one follows now.");
    expect(player.position?.wordIdx).toBe(1);
  });

  it("next() jumps while playing and cancels stale audio", async () => {
    await player.play();
    await waitFor(() => sink.scheduled.length > 0);
    await sink.advance(0.1);
    player.tick();
    expect(player.position?.sentence.text).toBe("First sentence here.");
    await player.next();
    await sink.advance(0.1);
    player.tick();
    expect(player.position?.sentence.text).toBe("Second one follows now.");
    expect(sink.scheduled.some((s) => s.stopped)).toBe(true);
  });

  it("pause and resume suspend the audio clock", async () => {
    await player.play();
    await waitFor(() => sink.scheduled.length > 0);
    await sink.advance(0.1);
    player.pause();
    expect(player.state).toBe("paused");
    expect(sink.running).toBe(false);
    player.resume();
    expect(sink.running).toBe(true);
  });

  it("reuses cached audio on replay", async () => {
    await player.play();
    for (let k = 0; k < 400 && player.state !== "idle"; k++) {
      await sink.advance(0.1);
      player.tick();
    }
    await flush();
    const calls = engine.calls;
    await player.play(srcPos(1, 0));
    for (let k = 0; k < 400 && player.state !== "idle"; k++) {
      await sink.advance(0.1);
      player.tick();
    }
    expect(engine.calls).toBe(calls);
  });

  it("applies the pitch trick and speed via playback rate", async () => {
    const fast = { ...prefs, speed: 1, pitch: 1.1 };
    player = new Player({ sink, cache: null, getEngine: async () => engine, prefs: () => fast });
    player.setModel(new ReadingModel(provider([["One sentence only."]]), DEFAULT_CLEANUP));
    await player.play();
    await waitFor(() => sink.scheduled.length > 0);
    expect(sink.scheduled[0].rate).toBeCloseTo(1.1);
  });
});

describe("alignTimings", () => {
  it("maps engine timings by char overlap and interpolates gaps", () => {
    const words = [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ];
    const out = alignTimings(
      [
        { start: 0, end: 0.2, charStart: 0, charEnd: 2 },
        { start: 0.6, end: 0.8, charStart: 6, charEnd: 8 },
      ],
      words,
      1,
    );
    expect(out[0].start).toBe(0);
    expect(out[1].start).toBeCloseTo(0.2);
    expect(out[2].start).toBe(0.6);
  });
});

// Silence unused import lint in some TS configs.
void MappedString;
