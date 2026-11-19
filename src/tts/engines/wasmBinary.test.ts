// @vitest-environment node
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadWasmBinary } from "./wasmBinary";

const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 7, 7, 7]);
const respond = (body: Uint8Array) => (async () => new Response(new Blob([body as BlobPart]))) as unknown as typeof fetch;

describe("loadWasmBinary", () => {
  it("decompresses a gzip-compressed wasm", async () => {
    const out = new Uint8Array(await loadWasmBinary("x.wasm.gz", respond(gzipSync(wasmBytes))));
    expect(Array.from(out)).toEqual(Array.from(wasmBytes));
  });
  it("accepts a binary the host already decoded", async () => {
    const out = new Uint8Array(await loadWasmBinary("x.wasm.gz", respond(wasmBytes)));
    expect(Array.from(out)).toEqual(Array.from(wasmBytes));
  });
  it("rejects anything else", async () => {
    await expect(loadWasmBinary("x", respond(new Uint8Array([60, 104, 116, 109, 108])))).rejects.toThrow(/not a valid/);
  });
});
