import { useLiveQuery } from "dexie-react-hooks";
import { Check, Cloud, Cpu, Pencil, Plus, Trash2 } from "lucide-react";
import { db, type VoiceRow } from "../../db/schema";
import { toast } from "../../app/toast";
import { player } from "../../app/session";
import { usePlayer } from "../../state/player";
import { useSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { getEngine } from "../../tts/registry";
import type { ChatterboxEngine } from "../../tts/engines/chatterbox";
import type { ElevenLabsEngine } from "../../tts/engines/elevenlabs";
import { Button, IconButton, cx } from "../ui";
import { PreviewButton } from "../layout/PlayerBar";

const voiceRef = (v: VoiceRow) => (v.engine === "chatterbox" ? { engine: "chatterbox" as const, voice: v.id } : { engine: "elevenlabs" as const, voice: v.elevenVoiceId ?? "" });

/** Cloned voices: list, select, preview, rename, delete, and the entry to the creator. */
export function MyVoices() {
  const voices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];
  const tts = useSettings((s) => s.tts);
  const bump = () => usePlayer.setState((p) => ({ voicesRev: p.voicesRev + 1 }));

  const select = (v: VoiceRow) => {
    const r = voiceRef(v);
    useSettings.getState().set("tts", { engine: r.engine, voices: { ...tts.voices, [r.engine]: r.voice } });
    player.stop();
  };

  const remove = async (v: VoiceRow) => {
    if (!confirm(`Delete the voice “${v.name}”? Its recording is removed from this device.`)) return;
    if (v.engine === "elevenlabs" && v.elevenVoiceId && confirm("Also delete it from your ElevenLabs account?")) {
      try {
        await (getEngine("elevenlabs") as ElevenLabsEngine).deleteVoice(v.elevenVoiceId);
      } catch (e) {
        toast((e as Error).message, "error", 7000);
      }
    }
    await db.voices.delete(v.id);
    if (v.engine === "chatterbox") (getEngine("chatterbox") as ChatterboxEngine).forgetVoice(v.id);
    else (getEngine("elevenlabs") as ElevenLabsEngine).invalidateVoices();
    bump();
  };

  return (
    <div>
      {voices.length === 0 && <p className="text-sm text-muted">No cloned voices yet.</p>}
      <ul className="space-y-1.5" data-testid="my-voices">
        {voices.map((v) => {
          const r = voiceRef(v);
          const selected = tts.engine === r.engine && tts.voices[r.engine] === r.voice;
          return (
            <li key={v.id} className={cx("flex items-center gap-2 rounded-lg border px-2 py-1.5", selected ? "border-accent bg-accent-soft" : "border-line")}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => select(v)} title="Use this voice">
                <span className="w-4 shrink-0 text-accent">{selected && <Check size={15} />}</span>
                <span className="min-w-0 flex-1 truncate">
                  {v.name}
                  <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-muted">
                    {v.engine === "chatterbox" ? <Cpu size={12} /> : <Cloud size={12} />}
                    {v.engine === "chatterbox" ? "on device" : "ElevenLabs"} · {Math.round(v.durationSec)} s sample
                  </span>
                </span>
              </button>
              {r.voice && <PreviewButton engine={r.engine} voice={r.voice} name={v.name} />}
              <IconButton
                label={`Rename ${v.name}`}
                className="h-7 w-7"
                onClick={async () => {
                  const n = prompt("Voice name", v.name)?.trim();
                  if (n) {
                    await db.voices.update(v.id, { name: n });
                    bump();
                  }
                }}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton label={`Delete ${v.name}`} className="h-7 w-7" onClick={() => void remove(v)}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button size="sm" className="mt-3" onClick={() => useUi.setState({ voiceCreatorOpen: true })} data-testid="create-voice">
        <Plus size={15} /> Create a voice
      </Button>
      <p className="mt-2 text-xs text-muted">Clone only your own voice or one you have permission to use.</p>
    </div>
  );
}
