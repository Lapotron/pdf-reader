import { floatToInt16 } from "../tts/pcm";

/** Encodes mono PCM to MP3 in a worker. */
export function encodeMp3(pcm: Float32Array, sampleRate: number, kbps = 96, onProgress?: (p: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), { type: "module", name: "mp3" });
    const i16 = floatToInt16(pcm);
    worker.onmessage = (e: MessageEvent<{ progress?: number; done?: boolean; parts?: Uint8Array[] }>) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      if (e.data.done) {
        worker.terminate();
        resolve(new Blob(e.data.parts as BlobPart[], { type: "audio/mpeg" }));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "MP3 encoder failed"));
    };
    worker.postMessage({ pcm: i16, sampleRate, kbps }, [i16.buffer]);
  });
}
