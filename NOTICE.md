# Third-party notices

Mega Reader's own source code is licensed under the MIT License (see `LICENSE`).
The built application bundles or downloads the following third-party components:

| Component | Use | License |
|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | PDF rendering and text extraction | Apache-2.0 |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model weights (ONNX export by `onnx-community`) | Local neural voices (downloaded at runtime) | Apache-2.0 |
| [kokoro-js](https://github.com/hexgrad/kokoro) | Kokoro inference in the browser | Apache-2.0 |
| [Transformers.js](https://github.com/huggingface/transformers.js) | Model loading and inference | Apache-2.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | WASM/WebGPU inference runtime | MIT |
| [phonemizer](https://www.npmjs.com/package/phonemizer) | Grapheme-to-phoneme conversion for Kokoro | Apache-2.0 (package) |
| ↳ [eSpeak NG](https://github.com/espeak-ng/espeak-ng) compiled to WebAssembly, bundled inside `phonemizer` | Phonemization | **GPL-3.0** |
| [lamejs](https://github.com/breezystack/lamejs) (`@breezystack/lamejs`) | MP3 encoding (loaded only in the MP3 export worker, as a separate unmodified chunk) | **LGPL-3.0** |
| [Microsoft Cognitive Services Speech SDK](https://github.com/microsoft/cognitive-services-speech-sdk-js) | Azure voices (loaded only when Azure is used) | MIT |
| React, React DOM | UI | MIT |
| Zustand | State management | MIT |
| Dexie | IndexedDB storage | Apache-2.0 |
| Lucide | Icons | ISC |
| Tailwind CSS | Styling (build time) | MIT |

## Notes on copyleft components

- **eSpeak NG (GPL-3.0)** is part of the `phonemizer` package that `kokoro-js` depends on, so
  builds that include Kokoro distribute GPL-3.0 code. If you redistribute the built app, make sure
  that is compatible with your distribution terms, or build a variant without the Kokoro engine.
- **lamejs (LGPL-3.0)** is kept in its own dynamically imported chunk (`mp3.worker-*.js`) and is
  not modified, so it can be replaced. Its source is available at the link above.

Cloud engines (OpenAI, ElevenLabs, Azure) are optional services governed by their providers' terms.
Text is sent to a provider only when you select that engine and supply your own API key.
