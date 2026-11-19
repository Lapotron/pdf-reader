import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/schema";
import { AudioCache } from "./audioCache";

const clip = (n: number) => ({ pcm: new Float32Array(n).fill(0.25), sampleRate: 24000, timings: [], timingSource: "estimated" as const });

describe("AudioCache", () => {
  beforeEach(async () => {
    await db.audioCache.clear();
    await db.meta.clear();
  });

  it("round-trips PCM through Int16 storage", async () => {
    const c = new AudioCache();
    await c.put("a", clip(100));
    const got = await c.get("a");
    expect(got?.pcm.length).toBe(100);
    expect(got?.pcm[0]).toBeCloseTo(0.25, 3);
    expect(await c.totalBytes()).toBe(200);
  });

  it("evicts least recently used entries when over the cap", async () => {
    const c = new AudioCache(1000); // bytes
    await c.put("old", clip(200)); // 400 bytes
    await new Promise((r) => setTimeout(r, 5));
    await c.put("mid", clip(200)); // 800
    await new Promise((r) => setTimeout(r, 5));
    await c.put("new", clip(200)); // 1200 > 1000 → evict to <= 900
    expect(await c.get("old")).toBeNull();
    expect(await c.get("mid")).not.toBeNull();
    expect(await c.get("new")).not.toBeNull();
    expect(await c.totalBytes()).toBeLessThanOrEqual(900);
  });

  it("clears entries for one document", async () => {
    const c = new AudioCache();
    await c.put("x", clip(10), "doc1");
    await c.put("y", clip(10), "doc2");
    await c.clear("doc1");
    expect(await c.get("x")).toBeNull();
    expect(await c.get("y")).not.toBeNull();
    expect(await c.totalBytes()).toBe(20);
  });
});
