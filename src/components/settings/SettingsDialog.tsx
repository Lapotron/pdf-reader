import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Download, Plus, Trash2, Upload, Volume2 } from "lucide-react";
import { getSession, refreshTextOptions, player } from "../../app/session";
import { previewVoice } from "../../app/preview";
import { prepareKokoroOffline } from "../../app/offline";
import { toast } from "../../app/toast";
import { applyPlaybackChange } from "../../app/actions";
import { SHORTCUTS } from "../../app/shortcuts";
import { db } from "../../db/schema";
import { saveBlob } from "../../lib/download";
import { srcPos } from "../../pdf/types";
import { useKeys } from "../../state/keys";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { DEFAULT_VOICES, DEFAULTS, useSettings, type RulerSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { MappedString } from "../../text/mappedString";
import { buildDisplay, buildSpeech, pageToMapped, type CleanupOptions } from "../../text/cleanup";
import { applyRules, compileRule, compileRules, type PronunciationRule } from "../../text/pronunciation";
import { audioCache } from "../../tts/audioCache";
import { KOKORO_SIZES_MB } from "../../tts/engines/kokoroProtocol";
import { ENGINE_INFO, resetEngine } from "../../tts/registry";
import type { EngineId } from "../../tts/types";
import { Button, ColorInput, Dialog, Kbd, ProgressBar, Section, Segmented, Select, Slider, TextInput, Toggle, cx } from "../ui";
import { VoiceList } from "../layout/PlayerBar";
import { hexToRgba } from "../reader/PageView";

const TABS = [
  { id: "voice", label: "Voice & engine" },
  { id: "reading", label: "Reading" },
  { id: "ruler", label: "Reading line" },
  { id: "cleanup", label: "Text cleanup" },
  { id: "pronunciation", label: "Pronunciation" },
  { id: "appearance", label: "Appearance" },
  { id: "storage", label: "Storage" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

function EngineCards() {
  const engine = useSettings((s) => s.tts.engine);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ENGINE_INFO.map((e) => (
        <button
          key={e.id}
          role="radio"
          aria-checked={engine === e.id}
          onClick={() => {
            useSettings.getState().set("tts", { engine: e.id });
            player.stop();
          }}
          className={cx("rounded-xl border p-3 text-left transition-colors", engine === e.id ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2")}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{e.label}</span>
            <span className={cx("h-4 w-4 rounded-full border-2", engine === e.id ? "border-accent bg-accent" : "border-line")} />
          </span>
          <span className="mt-1 block text-xs text-muted">{e.description}</span>
          <span className="mt-2 flex flex-wrap gap-1">
            {e.badges.map((b) => (
              <span key={b} className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-muted">
                {b}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

function KokoroSettings() {
  const t = useSettings((s) => s.tts);
  const set = (p: Partial<typeof t>) => useSettings.getState().set("tts", p);
  const status = usePlayer((s) => s.engineStatus);
  const active = usePlayer((s) => s.activeEngine);
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const dtypeLabel = (d: keyof typeof KOKORO_SIZES_MB) => `${d} · ${KOKORO_SIZES_MB[d]} MB`;
  return (
    <>
      <Select
        label="Device"
        description={gpu ? "WebGPU is available: fast generation on your graphics card." : "WebGPU not detected: Kokoro runs on the CPU (WASM), which is slower."}
        value={t.kokoroDevice}
        onChange={(v) => {
          set({ kokoroDevice: v });
          resetEngine("kokoro");
        }}
        options={[
          { value: "auto", label: "Automatic" },
          { value: "webgpu", label: "WebGPU (GPU)" },
          { value: "wasm", label: "WASM (CPU)" },
        ]}
      />
      <Select
        label="Model precision"
        description="Automatic picks fp32 on WebGPU (best quality) and q8 on CPU (smaller, faster download)."
        value={t.kokoroDtype}
        onChange={(v) => {
          set({ kokoroDtype: v });
          resetEngine("kokoro");
        }}
        options={[
          { value: "auto", label: "Automatic" },
          { value: "fp32", label: dtypeLabel("fp32") },
          { value: "fp16", label: dtypeLabel("fp16") },
          { value: "q8", label: dtypeLabel("q8") },
          { value: "q4f16", label: dtypeLabel("q4f16") },
        ]}
      />
      {active === "kokoro" && status.state === "downloading" && status.progress && <ProgressBar value={status.progress.loaded / Math.max(1, status.progress.total)} className="my-2" />}
      {active === "kokoro" && status.state === "ready" && (
        <p className="py-1 text-xs text-muted">
          Loaded on {status.device === "webgpu" ? "WebGPU" : "CPU (WASM)"} with {status.dtype} precision. The model is cached for offline use.
        </p>
      )}
      {status.state === "error" && active === "kokoro" && <p className="py-1 text-xs text-danger">{status.error}</p>}
      <OfflineButton />
    </>
  );
}

function OfflineButton() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await prepareKokoroOffline();
            usePlayer.setState({ activeEngine: "kokoro" });
            toast("Kokoro and your voice are downloaded — reading works offline now.", "success", 6000);
          } catch (e) {
            toast(`Download failed: ${(e as Error).message}`, "error", 7000);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={15} /> {busy ? "Downloading…" : "Download for offline use"}
      </Button>
      <p className="mt-1 text-xs text-muted">Fetches the model and the selected voice now, so the first play is instant and works without internet.</p>
    </div>
  );
}

function KeyWarning() {
  const remember = useKeys((s) => s.remember);
  return (
    <div className="mt-2 rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted">
      <p className="flex items-start gap-1.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <span>
          Keys are sent only to the provider you choose, directly from this browser. They are stored {remember ? "in this browser's local storage" : "for this tab session only"}; any script running on this page could read them. Prefer a restricted, low-quota key.
        </span>
      </p>
      <div className="mt-1">
        <Toggle checked={remember} onChange={(v) => useKeys.getState().setRemember(v)} label="Remember keys on this device" />
      </div>
    </div>
  );
}

function CloudSettings({ engine }: { engine: EngineId }) {
  const t = useSettings((s) => s.tts);
  const keys = useKeys();
  const set = (p: Partial<typeof t>) => useSettings.getState().set("tts", p);
  if (engine === "openai")
    return (
      <>
        <TextInput label="OpenAI API key" type="password" value={keys.openai} onChange={(v) => keys.setKey("openai", v)} placeholder="sk-…" />
        <Select
          label="Model"
          value={t.openaiModel}
          onChange={(v) => set({ openaiModel: v })}
          options={[
            { value: "gpt-4o-mini-tts", label: "gpt-4o-mini-tts (steerable)" },
            { value: "tts-1-hd", label: "tts-1-hd (high quality)" },
            { value: "tts-1", label: "tts-1 (fast)" },
          ]}
        />
        {t.openaiModel.startsWith("gpt-4o") && (
          <TextInput label="Voice instructions (optional)" value={t.openaiInstructions} onChange={(v) => set({ openaiInstructions: v })} placeholder="e.g. Calm, clear narrator. Moderate pace." />
        )}
        <TextInput
          label="API base URL"
          value={t.openaiBaseUrl}
          onChange={(v) => set({ openaiBaseUrl: v })}
          description="Point this at any OpenAI-compatible /v1/audio/speech server (for example a self-hosted Kokoro server) — the key is optional there."
        />
        <KeyWarning />
      </>
    );
  if (engine === "elevenlabs")
    return (
      <>
        <TextInput label="ElevenLabs API key" type="password" value={keys.elevenlabs} onChange={(v) => keys.setKey("elevenlabs", v)} />
        <Select
          label="Model"
          value={t.elevenModel}
          onChange={(v) => set({ elevenModel: v })}
          options={[
            { value: "eleven_multilingual_v2", label: "Multilingual v2 (best quality)" },
            { value: "eleven_turbo_v2_5", label: "Turbo v2.5 (fast, cheaper)" },
            { value: "eleven_flash_v2_5", label: "Flash v2.5 (fastest)" },
          ]}
        />
        <Slider label="Stability" value={t.elevenStability} min={0} max={1} step={0.05} onChange={(v) => set({ elevenStability: v })} format={(v) => v.toFixed(2)} />
        <Slider label="Similarity" value={t.elevenSimilarity} min={0} max={1} step={0.05} onChange={(v) => set({ elevenSimilarity: v })} format={(v) => v.toFixed(2)} />
        <KeyWarning />
      </>
    );
  if (engine === "azure")
    return (
      <>
        <TextInput label="Azure Speech key" type="password" value={keys.azure} onChange={(v) => keys.setKey("azure", v)} />
        <TextInput label="Region" value={t.azureRegion} onChange={(v) => set({ azureRegion: v.trim() })} placeholder="eastus" />
        <KeyWarning />
      </>
    );
  return null;
}

function VoiceTab() {
  const t = useSettings((s) => s.tts);
  const set = (p: Partial<typeof t>) => useSettings.getState().set("tts", p);
  return (
    <>
      <Section title="Engine" description="Kokoro runs entirely on your device. Cloud engines need your own API key and send text to that provider.">
        <EngineCards />
      </Section>
      {t.engine === "kokoro" && (
        <Section title="Kokoro">
          <KokoroSettings />
        </Section>
      )}
      {(t.engine === "openai" || t.engine === "elevenlabs" || t.engine === "azure") && (
        <Section title={ENGINE_INFO.find((e) => e.id === t.engine)?.label}>
          <CloudSettings engine={t.engine} />
        </Section>
      )}
      <Section title="Voice" description="Click a voice to select it; ▶ plays a preview.">
        <TextInput label="Preview sentence" value={t.previewText} onChange={(v) => set({ previewText: v })} />
        <VoiceList engine={t.engine} />
      </Section>
      <Section title="Delivery">
        <Slider
          label="Speed"
          value={t.speed}
          min={0.5}
          max={3}
          step={0.05}
          onChange={(v) => {
            set({ speed: v });
            applyPlaybackChange();
          }}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Slider
          label="Pitch"
          value={t.pitch}
          min={0.85}
          max={1.15}
          step={0.01}
          onChange={(v) => {
            set({ pitch: v });
            applyPlaybackChange();
          }}
          format={(v) => `${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`}
        />
        <Toggle checked={t.fallback} onChange={(v) => set({ fallback: v })} label="Fall back to browser voices" description="If the selected engine cannot start, keep reading with built-in voices." />
        <div className="mt-2">
          <Button size="sm" onClick={() => void previewVoice(t.engine, t.voices[t.engine] ?? DEFAULT_VOICES[t.engine]).catch((e) => toast((e as Error).message, "error"))}>
            <Volume2 size={15} /> Test current voice
          </Button>
        </div>
      </Section>
    </>
  );
}

function ReadingTab() {
  const r = useSettings((s) => s.reading);
  const set = (p: Partial<typeof r>) => useSettings.getState().set("reading", p);
  return (
    <>
      <Section title="Highlighting">
        <Select label="Sentence" value={r.sentenceStyle} onChange={(v) => set({ sentenceStyle: v })} options={[{ value: "fill", label: "Fill" }, { value: "underline", label: "Underline" }, { value: "off", label: "Off" }]} />
        <ColorInput label="Sentence color" value={r.sentenceColor} onChange={(v) => set({ sentenceColor: v })} />
        <Select label="Word" value={r.wordStyle} onChange={(v) => set({ wordStyle: v })} options={[{ value: "fill", label: "Fill" }, { value: "underline", label: "Underline" }, { value: "off", label: "Off" }]} />
        <ColorInput label="Word color" value={r.wordColor} onChange={(v) => set({ wordColor: v })} />
        <p className="text-xs text-muted">Kokoro and OpenAI do not report word timing, so word highlighting is estimated from the audio. ElevenLabs, Azure and browser voices give exact timing.</p>
      </Section>
      <Section title="Navigation">
        <Select
          label="Follow the voice"
          value={r.followMode}
          onChange={(v) => set({ followMode: v })}
          options={[
            { value: "keep-visible", label: "Keep line visible" },
            { value: "center-line", label: "Teleprompter (keep centered)" },
            { value: "off", label: "Off" },
          ]}
        />
        <Select
          label="Start reading on"
          value={r.clickToRead}
          onChange={(v) => set({ clickToRead: v })}
          options={[
            { value: "double", label: "Double-click a word" },
            { value: "single", label: "Single click a word" },
            { value: "off", label: "Alt+click only" },
          ]}
        />
        <Toggle checked={r.rememberPerDoc} onChange={(v) => set({ rememberPerDoc: v })} label="Remember voice and speed per document" />
      </Section>
      <Section title="Pacing & audio">
        <Slider label="Pause between sentences" value={r.pauseSentence} min={0} max={1} step={0.02} onChange={(v) => set({ pauseSentence: v })} format={(v) => `${Math.round(v * 1000)} ms`} />
        <Slider label="Pause between paragraphs" value={r.pauseParagraph} min={0} max={2} step={0.05} onChange={(v) => set({ pauseParagraph: v })} format={(v) => `${Math.round(v * 1000)} ms`} />
        <Slider label="Generate ahead" value={r.prefetchSeconds} min={5} max={90} step={5} onChange={(v) => set({ prefetchSeconds: v })} format={(v) => `${v} s`} />
        <Toggle checked={r.trimSilence} onChange={(v) => set({ trimSilence: v })} label="Trim silence around sentences" />
        <Toggle checked={r.normalize} onChange={(v) => set({ normalize: v })} label="Even out loudness" />
      </Section>
    </>
  );
}

function RulerPreview({ ruler }: { ruler: RulerSettings }) {
  const mask = ruler.mask || ruler.mode === "window";
  return (
    <div className="relative mt-3 overflow-hidden rounded-lg border border-line bg-white p-4 text-[13px] leading-6 text-gray-800" aria-hidden>
      <p>The reading line glides to the sentence being spoken.</p>
      <p className="relative">
        <span
          className="absolute -inset-x-2 -inset-y-0.5"
          style={{
            borderRadius: ruler.mode === "underline" ? 2 : 6,
            background: ruler.mode === "band" ? hexToRgba(ruler.color, ruler.opacity) : "transparent",
            borderBottom: ruler.mode === "underline" ? `3px solid ${ruler.color}` : undefined,
            boxShadow: mask ? `0 0 0 400px ${hexToRgba(ruler.maskColor, ruler.maskOpacity)}${ruler.mode === "window" ? `, inset 0 0 0 1.5px ${hexToRgba(ruler.color, 0.7)}` : ""}` : undefined,
            ...(ruler.enabled ? {} : { display: "none" }),
          }}
        />
        <span className="relative">This is the line you are reading right now.</span>
      </p>
      <p>Everything else can be dimmed so your eyes stay on track.</p>
    </div>
  );
}

function RulerTab() {
  const r = useSettings((s) => s.ruler);
  const set = (p: Partial<RulerSettings>) => useSettings.getState().set("ruler", p);
  return (
    <>
      <Section title="Floating reading line" description="A focus guide that follows the line being read. When not playing it can follow your mouse or the ↑/↓ keys.">
        <Toggle checked={r.enabled} onChange={(v) => set({ enabled: v })} label="Show reading line" />
        <div className="flex items-center justify-between py-2">
          <span className="text-sm">Style</span>
          <Segmented label="Style" value={r.mode} onChange={(v) => set({ mode: v })} options={[{ value: "band", label: "Band" }, { value: "underline", label: "Underline" }, { value: "window", label: "Window" }]} />
        </div>
        <ColorInput label="Color" value={r.color} onChange={(v) => set({ color: v })} />
        {r.mode === "band" && <Slider label="Band opacity" value={r.opacity} min={0.05} max={0.6} step={0.01} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />}
        <div className="flex items-center justify-between py-2">
          <span className="text-sm">Width</span>
          <Segmented label="Width" value={r.span} onChange={(v) => set({ span: v })} options={[{ value: "line", label: "Line" }, { value: "column", label: "Column" }, { value: "page", label: "Page" }]} />
        </div>
        <Select label="Height" value={r.heightMode} onChange={(v) => set({ heightMode: v })} options={[{ value: "line", label: "Match text line" }, { value: "fixed", label: "Fixed" }]} />
        {r.heightMode === "fixed" && <Slider label="Fixed height" value={r.heightPx} min={12} max={120} step={2} onChange={(v) => set({ heightPx: v })} format={(v) => `${v}px`} />}
        <Slider label="Padding" value={r.padding} min={0} max={10} step={0.5} onChange={(v) => set({ padding: v })} format={(v) => `${v} pt`} />
        <Select label="Also show upcoming lines" value={String(r.linesAhead) as "0" | "1" | "2"} onChange={(v) => set({ linesAhead: Number(v) as 0 | 1 | 2 })} options={[{ value: "0", label: "None" }, { value: "1", label: "1 line" }, { value: "2", label: "2 lines" }]} />
        <Slider label="Glide animation" value={r.animationMs} min={0} max={600} step={20} onChange={(v) => set({ animationMs: v })} format={(v) => (v ? `${v} ms` : "Off")} />
        <Select label="When not playing" value={r.manual} onChange={(v) => set({ manual: v })} options={[{ value: "mouse-snap", label: "Snap to line under mouse" }, { value: "mouse", label: "Follow mouse freely" }, { value: "off", label: "Hide" }]} />
      </Section>
      <Section title="Focus mask" description="Dim everything except the reading line (toggle with M).">
        <Toggle checked={r.mask} onChange={(v) => set({ mask: v })} label="Dim the rest of the page" />
        <ColorInput label="Mask color" value={r.maskColor} onChange={(v) => set({ maskColor: v })} />
        <Slider label="Mask strength" value={r.maskOpacity} min={0.05} max={0.9} step={0.05} onChange={(v) => set({ maskOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <RulerPreview ruler={r} />
      </Section>
    </>
  );
}

function CleanupPreview({ opts }: { opts: CleanupOptions }) {
  const page = usePlayer((s) => s.position?.page) ?? useReader.getState().currentPage;
  const [data, setData] = useState<{ segments: { text: string; kept: boolean }[]; speech: string } | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) return;
    let cancelled = false;
    void (async () => {
      const pt = await s.text.getPageText(page);
      const rules = compileRules(await db.pronunciations.toArray(), s.docId);
      const speech = buildSpeech(buildDisplay([pt], opts), opts, rules);
      // Mark which source chars survive into speech.
      const kept = new Uint8Array(pt.source.length);
      const base = srcPos(page, 0);
      for (let i = 0; i < speech.length; i++) {
        const p = speech.map[i] - base;
        if (p >= 0 && p < kept.length) kept[p] = 1;
      }
      // Removed whole lines are shown struck through; synthetic separators count as kept.
      const stage = pageToMapped(pt, opts);
      const stageKept = new Uint8Array(pt.source.length);
      for (let i = 0; i < stage.length; i++) {
        const p = stage.map[i] - base;
        if (p >= 0 && p < kept.length) stageKept[p] = 1;
      }
      const segments: { text: string; kept: boolean }[] = [];
      for (let i = 0; i < pt.source.length; i++) {
        const isKept = /\s/.test(pt.source[i]) ? stageKept[i] === 1 || kept[i] === 1 : kept[i] === 1;
        const last = segments[segments.length - 1];
        if (last && last.kept === isKept) last.text += pt.source[i];
        else segments.push({ text: pt.source[i], kept: isKept });
      }
      if (!cancelled) setData({ segments, speech: speech.text.replace(/\u2029/g, "\n\n") });
    })();
    return () => {
      cancelled = true;
    };
  }, [page, opts]);
  if (!getSession()) return <p className="text-xs text-muted">Open a document to preview the cleanup on a real page.</p>;
  if (!data) return <p className="text-xs text-muted">Preparing preview…</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Page {page} — original (struck = skipped)</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-2 font-sans text-xs leading-5">
          {data.segments.map((s, i) => (s.kept ? <span key={i}>{s.text}</span> : <del key={i} className="text-danger/80 decoration-danger/60">{s.text}</del>))}
        </pre>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">What will be spoken</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-2 font-sans text-xs leading-5">{data.speech}</pre>
      </div>
    </div>
  );
}

function CleanupTab() {
  const global = useSettings((s) => s.cleanup);
  const docId = useReader((s) => s.docId);
  const docPrefs = useLiveQuery(() => (docId ? db.docPrefs.get(docId) : undefined), [docId]);
  const overrides = (docPrefs?.cleanupOverrides as Partial<CleanupOptions> | undefined) ?? null;
  const [scope, setScope] = useState<"global" | "doc">("global");
  useEffect(() => {
    if (overrides && Object.keys(overrides).length) setScope("doc");
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts: CleanupOptions = useMemo(() => (scope === "doc" ? { ...global, ...(overrides ?? {}) } : global), [scope, global, overrides]);
  const set = async (p: Partial<CleanupOptions>) => {
    if (scope === "doc" && docId) {
      const prev = await db.docPrefs.get(docId);
      await db.docPrefs.put({ ...(prev ?? { docId }), docId, cleanupOverrides: { ...(overrides ?? {}), ...p } });
    } else useSettings.getState().set("cleanup", p);
    void refreshTextOptions();
  };
  const T = (k: keyof CleanupOptions, label: string, description?: string) => <Toggle checked={opts[k] as boolean} onChange={(v) => void set({ [k]: v } as Partial<CleanupOptions>)} label={label} description={description} />;
  return (
    <>
      {docId && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-sm">Apply changes to</span>
          <div className="flex items-center gap-2">
            <Segmented<"global" | "doc"> label="Scope" value={scope} onChange={setScope} options={[{ value: "global", label: "All documents" }, { value: "doc", label: "This document" }]} />
            {scope === "doc" && overrides && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const prev = await db.docPrefs.get(docId);
                  if (prev) await db.docPrefs.put({ ...prev, cleanupOverrides: undefined });
                  setScope("global");
                  void refreshTextOptions();
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </div>
      )}
      <Section title="Page furniture">
        {T("removeHeadersFooters", "Skip running headers and footers", "Learned from lines repeated across pages.")}
        {T("removePageNumbers", "Skip page numbers")}
        {T("skipFootnotes", "Skip footnotes")}
        {T("skipFootnoteMarkers", "Skip footnote markers (superscript numbers)")}
        {T("skipCaptions", "Skip figure and table captions")}
        {T("skipTables", "Skip tables", "Heuristic; may miss some tables.")}
        {T("skipRotated", "Skip rotated text (margin stamps)")}
      </Section>
      <Section title="Text">
        {T("dehyphenate", "Join words hyphenated across lines")}
        {T("skipCitationsNumeric", "Skip numeric citations like [12]")}
        {T("skipCitationsAuthorYear", "Skip author–year citations like (Smith, 2020)")}
        {T("skipEmails", "Skip email addresses")}
        {T("expandAbbreviations", "Expand abbreviations (e.g. → for example, Fig. → Figure)")}
        <Select label="Web links" value={opts.urls} onChange={(v) => void set({ urls: v })} options={[{ value: "domain", label: "Read domain only" }, { value: "skip", label: "Skip" }, { value: "read", label: "Read in full" }]} />
        <Select label="Multi-column layout" description="Automatic reads columns top to bottom, left then right." value={opts.columnDetection} onChange={(v) => void set({ columnDetection: v })} options={[{ value: "auto", label: "Detect columns" }, { value: "off", label: "Use PDF order" }]} />
      </Section>
      <Section title="Preview">
        <CleanupPreview opts={opts} />
      </Section>
    </>
  );
}

function newRule(): PronunciationRule {
  return { id: crypto.randomUUID(), pattern: "", replacement: "", regex: false, caseSensitive: false, wholeWord: true, enabled: true, scope: "global" };
}

function PronunciationTab() {
  const rules = useLiveQuery(() => db.pronunciations.toArray(), []) ?? [];
  const docId = useReader((s) => s.docId);
  const [test, setTest] = useState("SQL queries on GitHub use JSON.");
  const update = async (r: PronunciationRule) => {
    await db.pronunciations.put(r);
    void refreshTextOptions();
  };
  const remove = async (id: string) => {
    await db.pronunciations.delete(id);
    void refreshTextOptions();
  };
  const tested = useMemo(() => applyRules(MappedString.identity(test, 0), compileRules(rules, docId ?? undefined)).text, [test, rules, docId]);
  return (
    <>
      <Section title="Pronunciation dictionary" description="Replace words before they are spoken. Plain text or regular expressions ($1 for groups). Global rules apply first, then rules for this document.">
        <div className="space-y-2">
          {rules.map((r) => {
            const err = r.pattern ? ("error" in compileRule(r) ? (compileRule(r) as { error: string }).error : null) : null;
            return (
              <div key={r.id} className={cx("rounded-lg border p-2", err ? "border-danger" : "border-line")}>
                <div className="flex items-center gap-2">
                  <input value={r.pattern} onChange={(e) => void update({ ...r, pattern: e.target.value })} placeholder="Word or pattern" aria-label="Pattern" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 font-mono text-sm" />
                  <span className="text-muted">→</span>
                  <input value={r.replacement} onChange={(e) => void update({ ...r, replacement: e.target.value })} placeholder="Say as" aria-label="Replacement" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 text-sm" />
                  <button aria-label="Delete rule" className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-danger" onClick={() => void remove(r.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {(
                    [
                      ["enabled", "On"],
                      ["wholeWord", "Whole word"],
                      ["caseSensitive", "Match case"],
                      ["regex", "Regex"],
                    ] as const
                  ).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1">
                      <input type="checkbox" checked={r[k]} onChange={(e) => void update({ ...r, [k]: e.target.checked })} /> {l}
                    </label>
                  ))}
                  <select value={r.scope === "global" ? "global" : "doc"} disabled={!docId && r.scope === "global"} onChange={(e) => void update({ ...r, scope: e.target.value === "global" ? "global" : (docId ?? "global") })} className="rounded border border-line bg-panel-2 px-1 py-0.5" aria-label="Scope">
                    <option value="global">All documents</option>
                    {(docId || r.scope !== "global") && <option value="doc">{r.scope !== "global" && r.scope !== docId ? "Another document" : "This document"}</option>}
                  </select>
                  {err && <span className="text-danger">{err}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void update(newRule())}>
            <Plus size={15} /> Add rule
          </Button>
          <Button size="sm" variant="ghost" onClick={() => saveBlob(new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" }), "pronunciations.json")} disabled={!rules.length}>
            <Download size={15} /> Export
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium hover:bg-panel-2">
            <Upload size={15} /> Import
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const list = JSON.parse(await f.text()) as PronunciationRule[];
                  await db.pronunciations.bulkPut(list.filter((r) => r && typeof r.pattern === "string").map((r) => ({ ...newRule(), ...r })));
                  void refreshTextOptions();
                  toast(`Imported ${list.length} rules.`, "success");
                } catch {
                  toast("That file is not a valid rules export.", "error");
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </Section>
      <Section title="Test">
        <TextInput label="Sample text" value={test} onChange={setTest} />
        <p className="text-sm">
          <span className="text-muted">Spoken as: </span>
          {tested}
        </p>
        <Button size="sm" className="mt-2" onClick={() => void previewVoice(useSettings.getState().tts.engine, useSettings.getState().tts.voices[useSettings.getState().tts.engine] ?? "", tested).catch((e) => toast((e as Error).message, "error"))}>
          <Volume2 size={15} /> Speak
        </Button>
      </Section>
    </>
  );
}

function AppearanceTab() {
  const a = useSettings((s) => s.appearance);
  const set = (p: Partial<typeof a>) => useSettings.getState().set("appearance", p);
  return (
    <Section title="Theme">
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">Color theme</span>
        <Segmented label="Theme" value={a.theme} onChange={(v) => set({ theme: v })} options={[{ value: "light", label: "Light" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
      </div>
      <Toggle checked={a.pageTint} onChange={(v) => set({ pageTint: v })} label="Tint PDF pages to match the theme" description="Dark mode inverts page colors; sepia warms them." />
    </Section>
  );
}

function StorageTab() {
  const cacheMB = useSettings((s) => s.reading.audioCacheMB);
  const [bytes, setBytes] = useState<number | null>(null);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const refresh = () => {
    void audioCache.recount().then(setBytes);
    navigator.storage?.estimate?.().then((e) => setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
    navigator.storage?.persisted?.().then(setPersisted);
  };
  useEffect(refresh, []);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    <>
      <Section title="Audio cache" description="Generated speech is cached so replays and exports are instant.">
        <p className="text-sm">Using {bytes === null ? "…" : mb(bytes)}</p>
        <Slider label="Maximum size" value={cacheMB} min={50} max={2000} step={50} onChange={(v) => useSettings.getState().set("reading", { audioCacheMB: v })} format={(v) => `${v} MB`} />
        <Button size="sm" variant="danger" onClick={async () => (await audioCache.clear(), refresh(), toast("Audio cache cleared."))}>
          Clear audio cache
        </Button>
      </Section>
      <Section title="Browser storage">
        {est && <p className="text-sm">{mb(est.usage)} used of {mb(est.quota)} available.</p>}
        <p className="mt-1 text-xs text-muted">{persisted ? "Storage is persistent: the browser will not evict your library." : "Storage may be cleared by the browser when space runs low."}</p>
        {!persisted && (
          <Button size="sm" className="mt-2" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>
            Make storage persistent
          </Button>
        )}
      </Section>
      <Section title="Voice model" description="Kokoro's model files are cached by the browser after the first download.">
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            resetEngine("kokoro");
            for (const k of await caches.keys()) if (/transformers|kokoro/.test(k)) await caches.delete(k);
            toast("Voice model removed. It will download again when needed.");
            refresh();
          }}
        >
          Remove downloaded voice model
        </Button>
      </Section>
      <Section title="Reset">
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (confirm("Reset all settings to defaults? Your library is kept.")) {
              useSettings.getState().reset();
              toast("Settings reset.");
            }
          }}
        >
          Reset all settings
        </Button>
        <Button size="sm" variant="ghost" className="ml-2" onClick={() => (useKeys.getState().clearAll(), toast("API keys removed."))}>
          Forget API keys
        </Button>
      </Section>
    </>
  );
}

function ShortcutsTab() {
  return (
    <Section title="Keyboard shortcuts">
      <table className="w-full text-sm">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="py-2 pr-4">
                <Kbd>{k}</Kbd>
              </td>
              <td className="py-2 text-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function AboutTab() {
  return (
    <>
      <Section title="Mega Reader">
        <p className="text-sm text-muted">A PDF reader built around natural text-to-speech. Your documents, notes and settings stay in this browser.</p>
      </Section>
      <Section title="Third-party software">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>PDF.js — Apache-2.0</li>
          <li>Kokoro-82M model and kokoro-js — Apache-2.0</li>
          <li>Transformers.js and ONNX Runtime Web — Apache-2.0 / MIT</li>
          <li>phonemizer (bundles eSpeak NG compiled to WebAssembly) — eSpeak NG is GPL-3.0</li>
          <li>
            lamejs MP3 encoder (@breezystack/lamejs) — LGPL-3.0, loaded as a separate, unmodified module (
            <a className="text-accent underline" href="https://github.com/breezystack/lamejs" target="_blank" rel="noreferrer">
              source
            </a>
            )
          </li>
          <li>React, Zustand, Dexie, Lucide — MIT / Apache-2.0 / ISC</li>
        </ul>
      </Section>
    </>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const tab = useUi((s) => s.settingsTab);
  const setTab = (t: string) => useUi.setState({ settingsTab: t });
  return (
    <Dialog open={open} onClose={onClose} title="Settings" wide>
      <div className="flex min-h-[60vh] flex-col md:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 md:w-48 md:flex-col md:border-b-0 md:border-r">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id} className={cx("whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm", tab === t.id ? "bg-accent-soft text-accent" : "hover:bg-panel-2")}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === "voice" && <VoiceTab />}
          {tab === "reading" && <ReadingTab />}
          {tab === "ruler" && <RulerTab />}
          {tab === "cleanup" && <CleanupTab />}
          {tab === "pronunciation" && <PronunciationTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "storage" && <StorageTab />}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </Dialog>
  );
}

export { DEFAULTS };
