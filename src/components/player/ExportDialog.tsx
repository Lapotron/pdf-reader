import { useEffect, useRef, useState } from "react";
import { getSession, playbackPrefs } from "../../app/session";
import { toast } from "../../app/toast";
import { exportRange, type ExportProgress } from "../../export/exporter";
import { encodeMp3 } from "../../export/mp3";
import { toVtt } from "../../export/subtitles";
import { encodeWav } from "../../export/wav";
import { saveBlob, safeFileName } from "../../lib/download";
import { chapterRange } from "../../pdf/outline";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { useUi } from "../../state/ui";
import { audioCache } from "../../tts/audioCache";
import { activeEngine } from "../../tts/registry";
import { isLive, type EngineId } from "../../tts/types";
import { Button, Dialog, ProgressBar, Segmented, Toggle } from "../ui";

type RangeMode = "page" | "chapter" | "range" | "all";

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  const numPages = useReader((s) => s.numPages);
  const current = usePlayer((s) => s.position?.page) ?? useReader.getState().currentPage;
  const outline = useReader((s) => s.outline);
  const title = useReader((s) => s.title);
  const [mode, setMode] = useState<RangeMode>("page");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [subs, setSubs] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const chapter = chapterRange(outline, current, numPages);

  useEffect(() => {
    if (open) {
      setFrom(current);
      setTo(Math.min(numPages, current + 4));
    }
  }, [open, current, numPages]);

  const range = (): [number, number] => {
    if (mode === "page") return [current, current];
    if (mode === "chapter" && chapter) return chapter;
    if (mode === "all") return [1, numPages];
    const a = Math.max(1, Math.min(from, to));
    return [a, Math.min(numPages, Math.max(from, to))];
  };

  async function run() {
    const s = getSession();
    if (!s) return;
    const [a, b] = range();
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const engine = await activeEngine();
      if (isLive(engine)) throw new Error("Browser voices cannot be exported. Choose Kokoro or a cloud engine.");
      const prefs = playbackPrefs(engine.id as EngineId);
      const res = await exportRange(s.model, engine, prefs, a, b, audioCache, setProgress, ctrl.signal);
      if (!res.pcm.length) throw new Error("No readable text in this range.");
      setProgress({ done: 0, total: 1, phase: "encoding" });
      const base = `${safeFileName(title)} - p${a}${b !== a ? `-${b}` : ""}`;
      const blob = format === "mp3" ? await encodeMp3(res.pcm, res.sampleRate, 96, (p) => setProgress({ done: p, total: 1, phase: "encoding" })) : encodeWav(res.pcm, res.sampleRate);
      saveBlob(blob, `${base}.${format}`);
      if (subs) saveBlob(new Blob([toVtt(res.cues)], { type: "text/vtt" }), `${base}.vtt`);
      toast(`Exported ${Math.round(res.pcm.length / res.sampleRate / 60)} min of audio.`, "success");
      useUi.setState({ exportOpen: false });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast(`Export failed: ${(e as Error).message}`, "error", 7000);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  const [a, b] = range();
  const busy = progress !== null;
  return (
    <Dialog
      open={open}
      onClose={() => {
        abort.current?.abort();
        useUi.setState({ exportOpen: false });
      }}
      title="Export audio"
      footer={
        busy ? (
          <Button onClick={() => abort.current?.abort()}>Cancel</Button>
        ) : (
          <>
            <Button onClick={() => useUi.setState({ exportOpen: false })}>Close</Button>
            <Button variant="primary" onClick={run} data-testid="export-run">
              Export {b - a + 1} page{b === a ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-2 text-sm font-medium">Range</p>
          <Segmented<RangeMode>
            label="Range"
            value={mode}
            onChange={setMode}
            options={[
              { value: "page", label: `Page ${current}` },
              { value: "chapter", label: "Chapter", title: chapter ? `Pages ${chapter[0]}–${chapter[1]}` : "No outline" },
              { value: "range", label: "Pages…" },
              { value: "all", label: "Whole document" },
            ]}
          />
          {mode === "range" && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              From
              <input type="number" min={1} max={numPages} value={from} onChange={(e) => setFrom(Number(e.target.value))} className="h-8 w-20 rounded-md border border-line bg-panel-2 px-2" aria-label="From page" />
              to
              <input type="number" min={1} max={numPages} value={to} onChange={(e) => setTo(Number(e.target.value))} className="h-8 w-20 rounded-md border border-line bg-panel-2 px-2" aria-label="To page" />
            </div>
          )}
          {mode === "chapter" && !chapter && <p className="mt-2 text-xs text-muted">No outline found; the current page will be exported.</p>}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Format</p>
          <Segmented<"mp3" | "wav">
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "mp3", label: "MP3 (small)" },
              { value: "wav", label: "WAV (lossless)" },
            ]}
          />
        </div>
        <Toggle checked={subs} onChange={setSubs} label="Also save subtitles (.vtt)" description="Sentence-level captions that line up with the audio." />
        <p className="text-xs text-muted">Uses your current engine, voice and speed. Audio already generated while listening is reused from the cache.</p>
        {progress && (
          <div>
            <ProgressBar value={progress.total ? progress.done / progress.total : null} />
            <p className="mt-1.5 text-xs text-muted">
              {progress.phase === "planning" && "Preparing text…"}
              {progress.phase === "synthesizing" && `Generating speech: sentence ${progress.done} of ${progress.total}`}
              {progress.phase === "encoding" && "Encoding audio…"}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
