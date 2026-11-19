/**
 * Fetches the ONNX Runtime wasm. It is shipped gzip-compressed (static hosts such as Cloudflare
 * Pages reject files over 25 MiB); if a host already decoded it (Content-Encoding), use as is.
 */
export async function loadWasmBinary(url: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not load the ONNX Runtime (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) return bytes.buffer as ArrayBuffer; // "\0asm"
  throw new Error("The ONNX Runtime file is not a valid wasm or gzip file");
}
