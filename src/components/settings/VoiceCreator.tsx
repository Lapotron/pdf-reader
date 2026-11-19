import { useEffect, useRef, useState } from "react";
import { FileAudio, Mic, Play, Square, Loader2, Cpu, Cloud } from "lucide-react";
import { db } from "../../db/schema";
import { encodeWav } from "../../export/wav";
import { previewVoice, stopPreview } from "../../app/preview";
import { sink } from "../../app/session";
import { toast } from "../../app/toast";
import { useKeys } from "../../state/keys";
import { usePlayer } from "../../state/player";
import { useSettings } from "../../state/settings";
import { openSettings, useUi } from "../../state/ui";
import { getEngine } from "../../tts/registry";
import type { ChatterboxEngine } from "../../tts/engines/chatterbox";
import type { ElevenLabsEngine } from "../../tts/engines/elevenlabs";
import { CHATTERBOX_SIZE_MB } from "../../tts/engines/chatterboxProtocol";
import type { ScheduledSound } from "../../tts/audioSink";
import { usePreview } from "../../tts/preview";
import { clipToInt16Buffer, decodeToMono24k, prepareClip, READING_PASSAGE, startRecording, VOICE_SR, type PreparedClip, type Recorder } from "../../voices/capture";
import { Button, Dialog, ProgressBar, TextInput, cx } from "../ui";

type Step = "consent" | "capture" | "review";

function Waveform({ clip }: { clip: PreparedClip }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#2563eb";
    const muted = css.getPropertyValue("--muted").trim() || "#888";
    const n = clip.pcm.length;
    const a = (clip.refStart / n) * w;
    const b = (clip.refEnd / n) * w;
    g.fillStyle = accent + "22";
    g.fillRect(a, 0, b - a, h);
    for (let x = 0; x < w; x++) {
      const s = Math.floor((x / w) * n);
      const e = Math.floor(((x + 1) / w) * n);
      let peak = 0;
      for (let i = s; i < e; i++) peak = Math.max(peak, Math.abs(clip.pcm[i]));
      const y = Math.max(1, peak * h * 0.9);
      g.fillStyle = x >= a && x <= b ? accent : muted;
      g.fillRect(x, (h - y) / 2, 1, y);
    }
  }, [clip]);
  return <canvas ref={ref} className="h-20 w-full rounded-lg bg-panel-2" aria-label="Recording waveform; the highlighted part is used to learn the voice" />;
}

export function VoiceCreator() {
  const open = useUi((s) => s.voiceCreatorOpen);
  const close = () => useUi.setState({ voiceCreatorOpen: false });
  const [step, setStep] = useState<Step>("consent");
  const [consent, setConsent] = useState(false);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<PreparedClip | null>(null);
  const [name, setName] = useState("My voice");
  const [target, setTarget] = useState<"chatterbox" | "elevenlabs">("chatterbox");
  const [id, setId] = useState(() => `cv_${crypto.randomUUID()}`);
  const [playing, setPlaying] = useState<ScheduledSound | null>(null);
  const elevenKey = useKeys((s) => s.elevenlabs);
  const engineStatus = usePlayer((s) => s.engineStatus);
  const previewPhase = usePreview((s) => (s.target === `chatterbox:${id}` ? s.phase : null));
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;

  // Reset when reopened.
  useEffect(() => {
    if (!open) return;
    setStep("consent");
    setConsent(false);
    setClip(null);
    setError(null);
    setBusy(null);
    setName("My voice");
    setId(`cv_${crypto.randomUUID()}`);
  }, [open]);

  // Recording meter/timer.
  useEffect(() => {
    if (!recorder) return;
    let raf = 0;
    const loop = () => {
      setLevel(recorder.level());
      setElapsed(recorder.elapsed());
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [recorder]);

  useEffect(
    () => () => {
      recorder?.cancel();
      playing?.stop();
    },
    [recorder, playing],
  );

  async function loadAudio(blob: Blob) {
    setBusy("Analyzing the recording…");
    setError(null);
    try {
      const pcm = await decodeToMono24k(blob);
      const c = prepareClip(pcm);
      setClip(c);
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleRecording() {
    if (recorder) {
      const r = recorder;
      setRecorder(null);
      await loadAudio(await r.stop());
      return;
    }
    setError(null);
    try {
      setRecorder(await startRecording());
    } catch (e) {
      setError(`Microphone unavailable: ${(e as Error).message}`);
    }
  }

  async function playReference() {
    if (!clip) return;
    if (playing) {
      playing.stop();
      setPlaying(null);
      return;
    }
    stopPreview();
    await sink.ensureRunning();
    await sink.resume();
    const snd = sink.schedule(clip.pcm.slice(clip.refStart, clip.refEnd), VOICE_SR, sink.now + 0.05);
    setPlaying(snd);
    void snd.ended.then(() => setPlaying((p) => (p === snd ? null : p)));
  }

  async function previewClone() {
    if (!clip) return;
    if (previewPhase) return stopPreview();
    const engine = getEngine("chatterbox") as ChatterboxEngine;
    engine.setTempVoice(id, clip.pcm.slice(clip.refStart, clip.refEnd));
    await previewVoice("chatterbox", id).catch((e) => toast((e as Error).message, "error", 7000));
  }

  async function save() {
    if (!clip) return;
    const label = name.trim() || "My voice";
    setBusy(target === "chatterbox" ? "Saving…" : "Creating the voice at ElevenLabs…");
    setError(null);
    try {
      const base = { id, name: label, pcm24k: clipToInt16Buffer(clip.pcm), refStart: clip.refStart, refEnd: clip.refEnd, durationSec: clip.durationSec, createdAt: Date.now() };
      const s = useSettings.getState();
      if (target === "chatterbox") {
        await db.voices.put({ ...base, engine: "chatterbox" });
        s.set("tts", { engine: "chatterbox", voices: { ...s.tts.voices, chatterbox: id } });
      } else {
        const eleven = getEngine("elevenlabs") as ElevenLabsEngine;
        const voiceId = await eleven.cloneVoice(label, [encodeWav(clip.pcm, VOICE_SR)]);
        await db.voices.put({ ...base, engine: "elevenlabs", elevenVoiceId: voiceId });
        s.set("tts", { engine: "elevenlabs", voices: { ...s.tts.voices, elevenlabs: voiceId } });
      }
      usePlayer.setState((p) => ({ voicesRev: p.voicesRev + 1 }));
      toast(`“${label}” is ready and selected.`, "success", 6000);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const waitingModel = previewPhase === "preparing" && (engineStatus.state === "downloading" || engineStatus.state === "loading");

  const footer = (
    <>
      <Button onClick={close}>Cancel</Button>
      {step === "consent" && (
        <Button variant="primary" disabled={!consent} onClick={() => setStep("capture")} data-testid="voice-continue">
          Continue
        </Button>
      )}
      {step === "review" && (
        <Button variant="primary" onClick={save} disabled={!!busy || (target === "elevenlabs" && !elevenKey)} data-testid="voice-save">
          Save voice
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onClose={close} title="Create a voice" footer={footer}>
      <div className="space-y-4 px-5 py-4" data-testid="voice-creator">
        {step === "consent" && (
          <>
            <p className="text-sm">
              Record or upload about <strong>one minute</strong> of clear speech. The app learns the voice from it and can then read any document in that voice.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Use a quiet room and speak naturally, at your usual pace.</li>
              <li>English works best. Avoid music or other voices in the background.</li>
            </ul>
            <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="voice-consent" />
              <span>This is my own voice, or I have the speaker’s permission to clone it. I won’t use it to impersonate anyone.</span>
            </label>
          </>
        )}

        {step === "capture" && (
          <>
            <div className="rounded-lg bg-panel-2 p-3 text-sm leading-relaxed">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Read this aloud</p>
              {READING_PASSAGE}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={recorder ? "danger" : "primary"} onClick={toggleRecording} disabled={!!busy} data-testid="record-button">
                {recorder ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
                {recorder ? `Stop (${Math.floor(elapsed)} s)` : "Start recording"}
              </Button>
              <span className="text-sm text-muted">or</span>
              <label className={cx("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 text-sm font-medium hover:bg-panel-2", (recorder || busy) && "pointer-events-none opacity-50")}>
                <FileAudio size={16} /> Upload audio
                <input
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
                  hidden
                  data-testid="voice-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadAudio(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {recorder && (
              <div>
                <ProgressBar value={level} />
                <p className="mt-1 text-xs text-muted">{elapsed < 30 ? "Keep going — about a minute gives the best result." : elapsed < 60 ? "Good. A little more helps." : "Great, you can stop now."}</p>
              </div>
            )}
          </>
        )}

        {step === "review" && clip && (
          <>
            <Waveform clip={clip} />
            <p className="text-xs text-muted">
              {Math.round(clip.durationSec)} s recorded · {Math.round(clip.speechSec)} s of speech · the highlighted {Math.round((clip.refEnd - clip.refStart) / VOICE_SR)} s are used to learn the voice.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={playReference}>
                {playing ? <Square size={12} fill="currentColor" /> : <Play size={14} />} {playing ? "Stop" : "Play reference"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStep("capture")}>
                Record again
              </Button>
            </div>
            <TextInput label="Voice name" value={name} onChange={setName} />
            <div role="radiogroup" aria-label="Where to create the voice" className="grid gap-2">
              <button role="radio" aria-checked={target === "chatterbox"} onClick={() => setTarget("chatterbox")} className={cx("rounded-xl border p-3 text-left", target === "chatterbox" ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2")}>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Cpu size={15} /> On this device (private, free)
                </span>
                <span className="mt-1 block text-xs text-muted">
                  One-time ~{(CHATTERBOX_SIZE_MB / 1000).toFixed(1)} GB model download. {gpu
                    ? "WebGPU is available: generation uses your graphics card (roughly real time on a recent GPU)."
                    : "No WebGPU here: on a CPU this takes minutes per sentence, too slow for listening. Use Chrome or Edge on a computer with a GPU, or ElevenLabs."}{" "}
                  English only.
                </span>
              </button>
              <button role="radio" aria-checked={target === "elevenlabs"} onClick={() => setTarget("elevenlabs")} className={cx("rounded-xl border p-3 text-left", target === "elevenlabs" ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2")}>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Cloud size={15} /> ElevenLabs (cloud)
                </span>
                <span className="mt-1 block text-xs text-muted">
                  Best quality and exact word timing on any device. Needs an ElevenLabs plan with voice cloning.{" "}
                  {!elevenKey && (
                    <button className="text-accent underline" onClick={(e) => (e.stopPropagation(), close(), openSettings("voice"))}>
                      Add your API key first.
                    </button>
                  )}
                </span>
              </button>
            </div>
            {target === "chatterbox" && (
              <div>
                <Button size="sm" onClick={previewClone} disabled={!!busy} data-testid="clone-preview">
                  {previewPhase === "preparing" ? <Loader2 size={14} className="animate-spin" /> : previewPhase === "playing" ? <Square size={12} fill="currentColor" /> : <Play size={14} />}
                  {previewPhase ? "Stop preview" : "Preview the cloned voice"}
                </Button>
                {waitingModel && (
                  <div className="mt-2">
                    {engineStatus.state === "downloading" && engineStatus.progress ? (
                      <>
                        <ProgressBar value={engineStatus.progress.loaded / Math.max(1, engineStatus.progress.total)} />
                        <p className="mt-1 text-xs text-muted">
                          Downloading the voice-cloning model: {Math.round(engineStatus.progress.loaded / 1048576)} / {Math.round(engineStatus.progress.total / 1048576)} MB
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted">{engineStatus.message ?? "Loading the model…"}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 size={15} className="animate-spin" /> {busy}
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-danger/10 p-2.5 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
