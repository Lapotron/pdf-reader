import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Gauge, Loader2, Moon, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, Cpu, Cloud, Check } from "lucide-react";
import * as A from "../../app/actions";
import { previewVoice } from "../../app/preview";
import { getSession, player } from "../../app/session";
import { setSleepTimer } from "../../app/sleep";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { DEFAULT_VOICES, useSettings } from "../../state/settings";
import { openSettings, useUi } from "../../state/ui";
import { ENGINE_INFO, getEngine, selectedEngineId } from "../../tts/registry";
import { KOKORO_VOICES } from "../../tts/engines/kokoro";
import type { EngineId, VoiceInfo } from "../../tts/types";
import { IconButton, Popover, ProgressBar, Slider, cx } from "../ui";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function SpeedControl() {
  const speed = useSettings((s) => s.tts.speed);
  return (
    <Popover
      label="Playback speed"
      width={260}
      trigger={(open, toggle) => (
        <button onClick={toggle} aria-expanded={open} title="Speed ([ / ])" className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium tabular-nums hover:bg-panel-2" data-testid="speed-button">
          <Gauge size={16} className="text-muted" />
          {speed.toFixed(2).replace(/0$/, "")}×
        </button>
      )}
    >
      <Slider label="Speed" value={speed} min={0.5} max={3} step={0.05} onChange={A.setSpeed} format={(v) => `${v.toFixed(2)}×`} />
      <div className="mt-2 grid grid-cols-4 gap-1">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => A.setSpeed(s)} className={cx("rounded-md border py-1 text-xs tabular-nums", Math.abs(s - speed) < 0.01 ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-panel-2")}>
            {s}×
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function useVoices(engine: EngineId): { voices: VoiceInfo[]; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ voices: VoiceInfo[]; error: string | null; loading: boolean }>({ voices: engine === "kokoro" ? KOKORO_VOICES : [], error: null, loading: true });
  const status = usePlayer((s) => s.engineStatus.state);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    getEngine(engine)
      .listVoices()
      .then((v) => !cancelled && setState({ voices: v, error: null, loading: false }))
      .catch((e) => !cancelled && setState({ voices: [], error: (e as Error).message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [engine, status]);
  return state;
}

export function VoiceList({ engine, compact }: { engine: EngineId; compact?: boolean }) {
  const { voices, error, loading } = useVoices(engine);
  const selected = useSettings((s) => s.tts.voices[engine] ?? DEFAULT_VOICES[engine]);
  const [filter, setFilter] = useState("");
  const list = useMemo(() => voices.filter((v) => !filter || `${v.name} ${v.lang} ${v.id}`.toLowerCase().includes(filter.toLowerCase())), [voices, filter]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  return (
    <div>
      {voices.length > 8 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter voices" aria-label="Filter voices" className="mb-2 h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-sm" />}
      {loading && !voices.length && <p className="text-sm text-muted">Loading voices…</p>}
      {!loading && !voices.length && <p className="text-sm text-muted">No voices available. Check the API key in Settings.</p>}
      <ul className={cx("overflow-auto", compact ? "max-h-64" : "max-h-80")} role="listbox" aria-label="Voices">
        {list.map((v) => (
          <li key={v.id} role="option" aria-selected={v.id === selected} className={cx("group flex items-center gap-2 rounded-lg px-2 py-1.5", v.id === selected ? "bg-accent-soft" : "hover:bg-panel-2")}>
            <button className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => A.setVoice(engine, v.id)}>
              <span className="w-4 shrink-0 text-accent">{v.id === selected && <Check size={15} />}</span>
              <span className="min-w-0 flex-1 truncate">
                {v.name}
                <span className="ml-1.5 text-xs text-muted">
                  {v.lang}
                  {v.gender ? ` · ${v.gender === "f" ? "female" : "male"}` : ""}
                  {v.grade ? ` · grade ${v.grade}` : ""}
                </span>
              </span>
            </button>
            <IconButton label={`Preview ${v.name}`} className="h-7 w-7" onClick={() => void previewVoice(engine, v.id).catch((e) => usePlayer.setState({ error: (e as Error).message }))}>
              <Play size={13} />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VoiceControl() {
  const engine = useSettings((s) => s.tts.engine);
  const effective = selectedEngineId();
  const voiceId = useSettings((s) => s.tts.voices[effective] ?? DEFAULT_VOICES[effective]);
  const { voices } = useVoices(effective);
  const name = voices.find((v) => v.id === voiceId)?.name ?? (voiceId || "Default");
  return (
    <Popover
      label="Voice"
      width={340}
      trigger={(open, toggle) => (
        <button onClick={toggle} aria-expanded={open} className="flex h-9 max-w-40 items-center gap-1.5 rounded-lg px-2.5 text-sm hover:bg-panel-2" data-testid="voice-button">
          <span className="truncate">{name}</span>
        </button>
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <select
          aria-label="Engine"
          value={engine}
          onChange={(e) => {
            useSettings.getState().set("tts", { engine: e.target.value as EngineId });
            player.stop();
          }}
          className="h-8 flex-1 rounded-md border border-line bg-panel-2 px-2 text-sm"
        >
          {ENGINE_INFO.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <button className="text-xs text-accent hover:underline" onClick={() => openSettings("voice")}>
          More…
        </button>
      </div>
      <VoiceList engine={effective} compact />
    </Popover>
  );
}

function VolumeControl() {
  const volume = useSettings((s) => s.tts.volume);
  return (
    <Popover
      label="Volume"
      width={220}
      trigger={(open, toggle) => (
        <IconButton label="Volume" onClick={toggle} aria-expanded={open}>
          {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </IconButton>
      )}
    >
      <Slider label="Volume" value={volume} min={0} max={1} step={0.05} onChange={A.setVolume} format={(v) => `${Math.round(v * 100)}%`} />
    </Popover>
  );
}

function SleepControl() {
  const mode = usePlayer((s) => s.sleepMode);
  const until = usePlayer((s) => s.sleepUntil);
  const [, force] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const remaining = until ? Math.max(0, Math.ceil((until - Date.now()) / 60000)) : 0;
  return (
    <Popover
      label="Sleep timer"
      width={220}
      trigger={(open, toggle) => (
        <button onClick={toggle} aria-expanded={open} title="Sleep timer" className={cx("flex h-9 items-center gap-1 rounded-lg px-2 text-sm hover:bg-panel-2", mode !== "off" && "text-accent")}>
          <Moon size={17} />
          {mode === "time" && <span className="tabular-nums">{remaining}m</span>}
          {mode === "page" && <span>page</span>}
          {mode === "chapter" && <span>ch.</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-3 gap-1 text-sm">
          {[5, 10, 15, 20, 30, 45, 60, 90].map((m) => (
            <button key={m} onClick={() => (setSleepTimer("time", m), close())} className="rounded-md border border-line py-1.5 hover:bg-panel-2">
              {m} min
            </button>
          ))}
          <button onClick={() => (setSleepTimer("page"), close())} className="rounded-md border border-line py-1.5 hover:bg-panel-2">
            End of page
          </button>
          <button onClick={() => (setSleepTimer("chapter"), close())} className="col-span-2 rounded-md border border-line py-1.5 hover:bg-panel-2">
            End of chapter
          </button>
          <button onClick={() => (setSleepTimer("off"), close())} className="col-span-3 rounded-md py-1.5 text-muted hover:bg-panel-2">
            Turn off
          </button>
        </div>
      )}
    </Popover>
  );
}

function fmtMB(n: number) {
  return `${(n / 1024 / 1024).toFixed(0)} MB`;
}

function EngineChip() {
  const st = usePlayer((s) => s.engineStatus);
  const active = usePlayer((s) => s.activeEngine);
  const label = ENGINE_INFO.find((e) => e.id === active)?.label ?? "";
  let content;
  if (st.state === "downloading" && st.progress) {
    content = (
      <div className="w-40">
        <div className="flex justify-between text-[11px] text-muted">
          <span>Downloading voice</span>
          <span className="tabular-nums">
            {fmtMB(st.progress.loaded)} / {fmtMB(st.progress.total)}
          </span>
        </div>
        <ProgressBar value={st.progress.loaded / Math.max(1, st.progress.total)} className="mt-1" />
      </div>
    );
  } else if (st.state === "loading") {
    content = (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" /> <span className="max-w-40 truncate">{st.message ?? "Loading…"}</span>
      </span>
    );
  } else if (st.state === "error") {
    content = (
      <span className="flex items-center gap-1.5 text-xs text-danger">
        <AlertTriangle size={14} /> Engine error
      </span>
    );
  } else if (st.state === "ready" && st.rtf && st.rtf > 1.1) {
    content = (
      <span className="flex items-center gap-1.5 text-xs text-amber-600" title={`Generating at ${(1 / st.rtf).toFixed(1)}× real time. Use WebGPU (Chrome/Edge), a lighter precision, or a cloud voice for smooth playback.`}>
        <AlertTriangle size={14} /> Slow device
      </span>
    );
  } else if (st.state === "ready") {
    content = (
      <span className="flex items-center gap-1.5 text-xs text-muted" title={label}>
        {st.device === "cloud" ? <Cloud size={14} /> : <Cpu size={14} />}
        {st.device === "webgpu" ? "WebGPU" : st.device === "wasm" ? "CPU" : st.device === "cloud" ? "Cloud" : st.device === "browser" ? "Browser" : "Ready"}
      </span>
    );
  } else return null;
  return (
    <button className="hidden h-9 items-center rounded-lg px-2 hover:bg-panel-2 lg:flex" onClick={() => openSettings("voice")} data-testid="engine-status" data-state={st.state}>
      {content}
    </button>
  );
}

function Position() {
  const pos = usePlayer((s) => s.position);
  const state = usePlayer((s) => s.state);
  const err = usePlayer((s) => s.error);
  const n = useReader((s) => s.numPages);
  const currentPage = useReader((s) => s.currentPage);
  const speed = useSettings((s) => s.tts.speed);
  const page = pos?.page ?? currentPage;
  const minutesLeft = useMemo(() => {
    const s = getSession();
    if (!s) return null;
    let chars = 0;
    let pages = 0;
    for (let p = Math.max(1, page - 3); p <= Math.min(n, page + 3); p++) {
      const pt = s.text.peekPageText(p);
      if (pt) {
        chars += pt.source.length;
        pages++;
      }
    }
    if (!pages) return null;
    const perPage = chars / pages;
    return Math.round(((n - page + 0.5) * perPage) / (15 * speed) / 60);
  }, [page, n, speed]);
  if (err && state === "error")
    return (
      <p className="flex items-center gap-1.5 truncate text-sm text-danger" role="alert">
        <AlertTriangle size={15} className="shrink-0" /> <span className="truncate">{err}</span>
      </p>
    );
  return (
    <div className="min-w-0">
      <p className="truncate text-sm" data-testid="now-reading">
        {pos ? pos.text : <span className="text-muted">Press play, or double-click any sentence to start reading there.</span>}
      </p>
      <p className="text-xs text-muted tabular-nums">
        Page {page} of {n}
        {n > 0 && ` · ${Math.round(((page - 1) / Math.max(1, n - 1)) * 100)}%`}
        {minutesLeft !== null && minutesLeft > 0 && ` · ~${minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)} h ${minutesLeft % 60} min` : `${minutesLeft} min`} left`}
      </p>
    </div>
  );
}

export function PlayerBar() {
  const state = usePlayer((s) => s.state);
  const playing = state === "playing" || state === "buffering" || state === "loading";
  const busy = state === "buffering" || state === "loading";
  return (
    <footer className="flex h-16 shrink-0 items-center gap-2 border-t border-line bg-panel px-3" data-testid="player-bar" data-state={state}>
      <div className="flex items-center gap-1">
        <IconButton label="Previous sentence (←)" onClick={A.prevSentence}>
          <SkipBack size={18} />
        </IconButton>
        <button
          onClick={A.togglePlay}
          aria-label={playing ? "Pause (Space)" : "Play (Space)"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-transform hover:scale-105"
          data-testid="play-button"
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-px" />}
        </button>
        <IconButton label="Next sentence (→)" onClick={A.nextSentence} data-testid="next-button">
          <SkipForward size={18} />
        </IconButton>
      </div>
      <div className="min-w-0 flex-1 px-2">
        <div className="max-sm:hidden">
          <Position />
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <EngineChip />
        <SpeedControl />
        <VoiceControl />
        <span className="flex items-center gap-0.5 max-sm:hidden">
          <VolumeControl />
          <SleepControl />
          <IconButton label="Export audio" onClick={() => useUi.setState({ exportOpen: true })} data-testid="export-button">
            <Download size={18} />
          </IconButton>
        </span>
      </div>
    </footer>
  );
}
