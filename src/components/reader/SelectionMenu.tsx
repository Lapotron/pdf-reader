import { Copy, Highlighter, MessageSquarePlus, Play } from "lucide-react";
import { player } from "../../app/session";
import { toast } from "../../app/toast";
import { addHighlight, HIGHLIGHT_COLORS } from "../../db/annotations";
import { useReader } from "../../state/reader";
import { resumeFollow } from "../../state/ui";
import { IconButton } from "../ui";

/** Floating menu for a text selection: read from here, highlight, note, copy. */
export function SelectionMenu() {
  const sel = useReader((s) => s.selection);
  if (!sel) return null;
  const close = () => {
    useReader.setState({ selection: null });
    window.getSelection()?.removeAllRanges();
  };
  const left = Math.max(8, Math.min(window.innerWidth - 300, sel.x - 140));
  const top = Math.max(8, sel.y - 52);
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="fixed z-30 flex items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
      data-testid="selection-menu"
    >
      <IconButton
        label="Read from here"
        onClick={() => {
          resumeFollow();
          void player.play(sel.srcStart);
          close();
        }}
      >
        <Play size={16} />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`Highlight ${c}`}
          title="Highlight"
          className="mx-0.5 h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110"
          style={{ background: c }}
          onClick={async () => {
            const r = await addHighlight(sel.srcStart, sel.srcEnd, sel.text, c);
            if (!r) toast("Could not highlight this selection.", "error");
            close();
          }}
        />
      ))}
      <IconButton
        label="Highlight with note"
        onClick={async () => {
          const note = prompt("Note for this highlight:", "");
          if (note === null) return;
          await addHighlight(sel.srcStart, sel.srcEnd, sel.text, HIGHLIGHT_COLORS[0], note);
          close();
        }}
      >
        <MessageSquarePlus size={16} />
      </IconButton>
      <IconButton
        label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(sel.text);
          toast("Copied.");
          close();
        }}
      >
        <Copy size={16} />
      </IconButton>
      <span className="sr-only">
        <Highlighter />
      </span>
    </div>
  );
}
