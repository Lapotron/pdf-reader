import { db, type AudioCacheRow } from "../db/schema";
import { floatToInt16, int16ToFloat } from "./pcm";
import type { WordTiming } from "./types";

export interface CachedAudio {
  pcm: Float32Array;
  sampleRate: number;
  timings?: WordTiming[];
  timingSource: "engine" | "estimated";
}

const TOUCH_INTERVAL = 60_000;
const BYTES_KEY = "audioCacheBytes";

/** LRU cache of synthesized chunks in IndexedDB (Int16 PCM). */
export class AudioCache {
  private touched = new Map<string, number>();
  private bytes: number | null = null;
  maxBytes: number;
  enabled = true;

  constructor(maxBytes = 300 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  async get(key: string): Promise<CachedAudio | null> {
    if (!this.enabled) return null;
    try {
      const row = await db.audioCache.get(key);
      if (!row) return null;
      const now = Date.now();
      if (now - (this.touched.get(key) ?? 0) > TOUCH_INTERVAL) {
        this.touched.set(key, now);
        db.audioCache.update(key, { lastUsed: now }).catch(() => {});
      }
      return { pcm: int16ToFloat(new Int16Array(row.pcm)), sampleRate: row.sampleRate, timings: row.timings, timingSource: row.timingSource };
    } catch {
      return null;
    }
  }

  async put(key: string, a: CachedAudio, docId?: string): Promise<void> {
    if (!this.enabled) return;
    // Convert synchronously: callers may release their Float32 buffer right after this call.
    const pcm = floatToInt16(a.pcm).buffer as ArrayBuffer;
    try {
      await this.totalBytes(); // initialize the running total before writing (avoids double counting)
      const row: AudioCacheRow = { key, pcm, sampleRate: a.sampleRate, timings: a.timings, timingSource: a.timingSource, bytes: pcm.byteLength, lastUsed: Date.now(), docId };
      const prev = await db.audioCache.get(key);
      await db.audioCache.put(row);
      await this.addBytes(row.bytes - (prev?.bytes ?? 0));
      if ((await this.totalBytes()) > this.maxBytes) await this.evict();
    } catch (e) {
      console.warn("Audio cache write failed", e);
    }
  }

  async totalBytes(): Promise<number> {
    if (this.bytes === null) {
      const m = await db.meta.get(BYTES_KEY);
      this.bytes = typeof m?.v === "number" ? m.v : await this.recount();
    }
    return this.bytes;
  }

  private async addBytes(d: number): Promise<void> {
    const t = (await this.totalBytes()) + d;
    this.bytes = Math.max(0, t);
    await db.meta.put({ k: BYTES_KEY, v: this.bytes });
  }

  async recount(): Promise<number> {
    let total = 0;
    await db.audioCache.each((r) => {
      total += r.bytes;
    });
    this.bytes = total;
    await db.meta.put({ k: BYTES_KEY, v: total });
    return total;
  }

  /** Evicts least recently used entries until under 90% of the cap. */
  async evict(): Promise<void> {
    let total = await this.totalBytes();
    const target = this.maxBytes * 0.9;
    const victims: string[] = [];
    await db.audioCache.orderBy("lastUsed").until(() => total <= target).each((r) => {
      victims.push(r.key);
      total -= r.bytes;
    });
    await db.audioCache.bulkDelete(victims);
    this.bytes = Math.max(0, total);
    await db.meta.put({ k: BYTES_KEY, v: this.bytes });
  }

  async clear(docId?: string): Promise<void> {
    if (docId) await db.audioCache.where("docId").equals(docId).delete();
    else await db.audioCache.clear();
    await this.recount();
  }
}

export const audioCache = new AudioCache();
