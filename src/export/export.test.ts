import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";
import { toSrt, toVtt } from "./subtitles";

describe("export encoders", () => {
  it("writes a valid 16-bit mono WAV header", async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 24000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const txt = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
    expect(txt(0, 4)).toBe("RIFF");
    expect(txt(8, 12)).toBe("WAVE");
    expect(txt(36, 40)).toBe("data");
    const v = new DataView(buf.buffer);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(buf.length).toBe(44 + 8);
  });

  it("formats subtitle timestamps", () => {
    const cues = [{ start: 0, end: 1.5, text: "Hello." }, { start: 3661.25, end: 3662, text: "Later." }];
    expect(toVtt(cues)).toContain("00:00:00.000 --> 00:00:01.500");
    expect(toSrt(cues)).toContain("01:01:01,250 --> 01:01:02,000");
  });
});
