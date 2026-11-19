# Simple Reader

A PDF reader that reads to you with **natural neural voices** instead of the browser's robotic
built-in speech, plus a **floating reading line** that keeps your eyes on the line being spoken.

Everything runs in the browser. Documents, notes and settings stay on your device. It is a
static app, so it can be hosted on GitHub Pages or run locally.

## Features

**Read aloud**
- **Kokoro-82M neural TTS, on your device.** It runs in a Web Worker using WebGPU, or WASM on the CPU when WebGPU is unavailable.
  - Free, private, and works offline after a one-time model download (~90 MB on CPU, ~325 MB on WebGPU).
  - 28 English voices (US and UK).
- **Optional cloud voices** with your own API key:
  - OpenAI. Also works with any OpenAI-compatible `/v1/audio/speech` server, such as a self-hosted Kokoro server.
  - ElevenLabs.
  - Azure Neural.
- **Your own cloned voices** ("My voices"): record or upload about a minute of speech and the app learns the voice.
  - **On this device** with Chatterbox (Resemble AI, MIT) via Transformers.js: private and free, about 1.5 GB to download once. It needs a GPU with WebGPU (Chrome or Edge) to be usable; on a CPU it takes minutes per sentence. English only.
  - **With ElevenLabs** Instant Voice Cloning, using your API key and a plan that includes cloning.
  - Only clone your own voice or one you have permission to use.
- **Browser voices** as a last-resort fallback.
- **Gapless playback** through Web Audio. The app generates audio for the next sentences ahead of time and caches generated audio in IndexedDB, so replays and exports are instant.
- **Speed and pitch:** speed from 0.5× to 3×, a small pitch adjustment, and configurable pauses between sentences and paragraphs.
- **Sleep timer:** stop after N minutes, at the end of the page, or at the end of the chapter.
- **Media keys** work through the Media Session API.

**Stay focused**
- **Dark-mode page colors**: pages are recolored on the GPU instead of staying white. There are 7 color sets (Soft dark, Warm night, Midnight, OLED black, Low glare, High contrast, Sepia paper), all with at least 7:1 text contrast, in "keep colors" or "duotone" image modes.
- **Floating reading line**:
  - Styles: band, underline, or window.
  - Configurable color, opacity, width (line, column or page), height, padding, upcoming lines, and glide animation.
  - **Focus mask** (`M`) dims the rest of the page.
  - When playback is paused, the line follows your mouse or moves with `↑`/`↓`.
- **Sentence and word highlighting:**
  - Word timing is exact for ElevenLabs, Azure and browser voices.
  - For Kokoro and OpenAI it is estimated from silences in the audio, weighted by syllable count.
- **Auto-follow** keeps the spoken line on screen, either keeping it visible or keeping it centered like a teleprompter. It pauses while you scroll and offers a "Back to reading position" button.
- **Click to read:** double-click any word to start reading there.

**Smart text cleanup**
- Skips running headers, footers and page numbers. These are learned from lines that repeat across pages.
- Detects footnotes, footnote markers, captions, rotated margin text and simple tables. Each can be skipped.
- Joins words hyphenated across lines, using the document's own vocabulary to decide when to keep the hyphen.
- Reads multi-column layouts in the right order (XY-cut).
- Skips numeric citations such as `[12]` and, optionally, author–year citations. Shortens URLs to their domain, and can skip email addresses.
- Expands abbreviations, e.g. "e.g." → "for example" and "Fig." → "Figure".
- **Pronunciation dictionary:** plain-text or regex rules that apply to all documents or one document, with import/export and a test box.
- **Live preview** shows skipped text struck through next to exactly what will be spoken.

**Library and annotations**
- Local library with thumbnails, reading progress, and automatic resume at the sentence where you stopped.
- Per-document voice and speed memory.
- Bookmarks, highlights in 5 colors, and notes. Highlights can be exported as Markdown.
- Outline (table of contents), page thumbnails, and full-text search in the document, in a resizable sidebar.

**Extras**
- Export a page, a page range, a chapter or the whole document to **MP3 or WAV**, with optional **VTT subtitles**.
- Light, sepia and dark themes, with optional tinting of the PDF pages.
- Keyboard shortcuts for everything (`?` shows them).
- Installable **PWA** that works offline. When installed, it can open PDFs from the operating system.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL. Click **Try the sample** in the library, or drop in any PDF.

> The first time you press play, Kokoro downloads its model from Hugging Face. It is cached by the
> browser after that. For the fastest generation, use Chrome or Edge with WebGPU. On CPU-only devices,
> generation can be slower than real time, which causes short pauses between sentences. The app shows a
> "Slow device" hint when that happens.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server. `VITE_COI=1` adds COOP/COEP headers to test multi-threaded WASM. |
| `npm run build` | Production build into `dist/`. Set `VITE_BASE=/<repo>/` for GitHub Pages. |
| `npm run preview` | Serves the production build. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | Playwright smoke tests. They build the app and use a deterministic mock voice, so no network or GPU is needed. |
| `npm run fixtures` | Regenerates the test PDFs and `public/sample.pdf`. |
| `node scripts/make-icons.mjs` | Regenerates the PNG app icons from `public/icon.svg`. |

You can add `?engine=mock` to the URL to use the test-tone engine.

## Deploying

`.github/workflows/pages.yml` builds with `VITE_BASE=/<repo-name>/` and deploys to GitHub Pages on
pushes to `main`. To use it, enable Pages with the source set to "GitHub Actions".

Any static host works. Serve `dist/`, with `VITE_BASE` set to the path the app is served under.
The site needs HTTPS (offline mode, microphone recording and WebGPU require a secure origin) and
no rewrite rules (routes use `#/…`). Every file is under 25 MiB, so Cloudflare Pages' per-file
limit is respected: the 25.6 MiB voice-cloning runtime ships gzip-compressed and is decompressed
in the browser.

**Cloudflare Pages:** build command `npm run build`, output directory `dist`. Node 22 is selected by
`.nvmrc`. For a direct upload, build locally and run `npx wrangler pages deploy dist`.

## How it works

```
PDF ─► pdf.js text items ─► lines ─► blocks ─► reading order (XY-cut)
    ─► roles (header/footer/footnote/caption/table)
    ─► MappedString cleanup (every output char maps back to its source position)
    ─► sentences + words ─► chunks ─► TTS engine ─► Web Audio (gapless)
                                         ▲
             highlights, reading line and click-to-read use the same source mapping
```

- `src/pdf/`: extraction (`extract.ts`), layout and reading order (`layout.ts`), roles (`roles.ts`), and the per-document text provider (`document.ts`).
- `src/text/`: the core mapping layer and the speech-text pipeline:
  - `mappedString.ts` keeps an offset map back to the source through every edit.
  - `cleanup.ts` holds the cleanup stages.
  - `segment.ts` splits text into sentences and words.
  - `readingModel.ts` provides sentence navigation, hit-testing and highlight rectangles.
- `src/tts/`: the playback layer:
  - `player.ts` handles prefetching, scheduling and the playback clock.
  - `engines/*` contains Kokoro (worker plus proxy), OpenAI, ElevenLabs, Azure, Web Speech and the mock engine.
  - `timing.ts` estimates word timings when an engine does not provide them.
  - `audioCache.ts` is the IndexedDB LRU cache of generated audio.
- `src/components/`: the React UI (document view, reading line, player bar, sidebar panels, settings).

## Privacy and API keys

- With Kokoro, no document text leaves your device.
- With a cloud engine, sentence text is sent directly from your browser to that provider.
- API keys are stored only in this browser. By default they last for the session; choosing "remember" keeps them in local storage. Any script running on the page could read them, so use restricted, low-quota keys.

## License

MIT for this project's source code. See [NOTICE.md](NOTICE.md) for third-party licenses. Note that
Kokoro's phonemizer bundles **eSpeak NG (GPL-3.0)**, and the MP3 encoder is **LGPL-3.0**.
