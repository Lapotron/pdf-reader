export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ts = (t: number, sep: "." | ",") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
};

export function toVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${ts(c.start, ".")} --> ${ts(c.end, ".")}\n${c.text}\n`).join("\n");
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start, ",")} --> ${ts(c.end, ",")}\n${c.text}\n`).join("\n");
}
