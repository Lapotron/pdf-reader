// MP3 encoding in a worker. lamejs (LGPL-3.0) is loaded only here, as a separate chunk.
import { Mp3Encoder } from "@breezystack/lamejs";

const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

ctx.onmessage = (e: MessageEvent<{ pcm: Int16Array; sampleRate: number; kbps: number }>) => {
  const { pcm, sampleRate, kbps } = e.data;
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  const block = 1152 * 20;
  for (let i = 0; i < pcm.length; i += block) {
    const out = enc.encodeBuffer(pcm.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out));
    if ((i / block) % 20 === 0) ctx.postMessage({ progress: i / pcm.length });
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  ctx.postMessage({ done: true, parts }, parts.map((p) => p.buffer as ArrayBuffer));
};
