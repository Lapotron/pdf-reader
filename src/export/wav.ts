import { floatToInt16 } from "../tts/pcm";

/** Encodes mono Float32 PCM as a 16-bit WAV file. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const data = floatToInt16(pcm);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data.byteLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, data.byteLength, true);
  return new Blob([header, data.buffer as ArrayBuffer], { type: "audio/wav" });
}
