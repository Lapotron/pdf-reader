import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bookmark, BookmarkPlus, Download, Pencil, Play, Trash2 } from "lucide-react";
import { getSession, player } from "../../app/session";
import { bookmarkHere } from "../../app/actions";
import { navigate } from "../../app/useHashRoute";
import { db } from "../../db/schema";
import { HIGHLIGHT_COLORS } from "../../db/annotations";
import { saveBlob, safeFileName } from "../../lib/download";
import { buildDisplay } from "../../text/cleanup";
import { requestScroll, useReader } from "../../state/reader";
import { Button, IconButton, ProgressBar, cx } from "../ui";

export function OutlinePanel() {
  const outline = useReader((s) => s.outline);
  const current = useReader((s) => s.currentPage);
  const activeIdx = useMemo(() => {
    let idx = -1;
    outline.forEach((e, i) => {
      if (e.page !== null && e.page <= current) idx = i;
    });
    return idx;
  }, [outline, current]);
  if (!outline.length) return <p className="p-4 text-sm text-muted">This document has no outline. Use Thumbnails or Search to navigate.</p>;
  return (
    <ul className="py-1 text-sm">
      {outline.map((e, i) => (
        <li key={i}>
          <button
            disabled={e.page === null}
            onClick={() => e.page && requestScroll(e.page, e.y ?? undefined)}
            className={cx("flex w-full items-baseline gap-2 py-1.5 pr-3 text-left hover:bg-panel-2 disabled:opacity-50", i === activeIdx && "bg-accent-soft text-accent")}
            style={{ paddingLeft: 12 + e.depth * 14 }}
          >
            <span className="min-w-0 flex-1 truncate">{e.title}</span>
            {e.page && <span className="text-xs text-muted tabular-nums">{e.page}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumbnail({ page, active }: { page: number; active: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let made: string | null = null;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || made) return;
      io.disconnect();
      const s = getSession();
      if (!s) return;
      try {
        const pg = await s.pdf.getPage(page);
        const vp1 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: (140 * (window.devicePixelRatio || 1)) / vp1.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await pg.render({ canvas, viewport: vp }).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.75));
        canvas.width = 0;
        if (blob && !cancelled) {
          made = URL.createObjectURL(blob);
          setUrl(made);
        }
      } catch {
        /* ignore */
      }
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [page]);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const size = useReader((s) => s.sizes[page - 1]);
  return (
    <button ref={ref} onClick={() => requestScroll(page)} className="flex w-full flex-col items-center gap-1 py-2" aria-label={`Page ${page}`}>
      <div className={cx("w-[140px] overflow-hidden rounded border bg-white shadow-sm", active ? "border-accent ring-2 ring-accent" : "border-line")} style={{ aspectRatio: size ? `${size.w} / ${size.h}` : "3 / 4" }}>
        {url && <img src={url} alt="" className="h-full w-full" />}
      </div>
      <span className={cx("text-xs tabular-nums", active ? "text-accent" : "text-muted")}>{page}</span>
    </button>
  );
}

export function ThumbnailsPanel() {
  const n = useReader((s) => s.numPages);
  const current = useReader((s) => s.currentPage);
  return (
    <div className="py-1">
      {Array.from({ length: n }, (_, i) => (
        <Thumbnail key={i} page={i + 1} active={current === i + 1} />
      ))}
    </div>
  );
}

export function BookmarksPanel() {
  const docId = useReader((s) => s.docId);
  const marks = useLiveQuery(() => (docId ? db.bookmarks.where("docId").equals(docId).sortBy("page") : []), [docId]) ?? [];
  return (
    <div>
      <div className="p-3">
        <Button size="sm" className="w-full" onClick={() => void bookmarkHere()}>
          <BookmarkPlus size={15} /> Bookmark current position
        </Button>
      </div>
      {marks.length === 0 && <p className="px-4 text-sm text-muted">No bookmarks yet. Press B while reading.</p>}
      <ul className="text-sm">
        {marks.map((m) => (
          <li key={m.id} className="group flex items-start gap-2 px-3 py-2 hover:bg-panel-2">
            <Bookmark size={15} className="mt-0.5 shrink-0 text-accent" />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                requestScroll(m.page);
                if (m.srcPos !== undefined) void player.jumpTo(m.srcPos);
              }}
            >
              <span className="line-clamp-2">{m.label}</span>
              <span className="text-xs text-muted">Page {m.page}</span>
            </button>
            <IconButton
              label="Rename bookmark"
              className="h-7 w-7 opacity-0 group-hover:opacity-100"
              onClick={() => {
                const l = prompt("Bookmark name", m.label);
                if (l) void db.bookmarks.update(m.id!, { label: l });
              }}
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton label="Delete bookmark" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => void db.bookmarks.delete(m.id!)}>
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnnotationsPanel() {
  const docId = useReader((s) => s.docId);
  const title = useReader((s) => s.title);
  const [color, setColor] = useState<string | null>(null);
  const notes = useLiveQuery(() => (docId ? db.annotations.where("docId").equals(docId).toArray() : []), [docId]) ?? [];
  const list = notes.filter((n) => !color || n.color === color).sort((a, b) => a.srcStart - b.srcStart);
  const exportMd = () => {
    const md = [`# Highlights — ${title}`, "", ...list.map((a) => `- p. ${a.page}: “${a.quote}”${a.note ? `\n  - Note: ${a.note}` : ""}`)].join("\n");
    saveBlob(new Blob([md], { type: "text/markdown" }), `${safeFileName(title)} - highlights.md`);
  };
  return (
    <div>
      <div className="flex items-center gap-1.5 p-3">
        <button onClick={() => setColor(null)} className={cx("rounded-full border px-2 py-0.5 text-xs", !color ? "border-accent text-accent" : "border-line text-muted")}>
          All
        </button>
        {HIGHLIGHT_COLORS.map((c) => (
          <button key={c} aria-label={`Filter ${c}`} onClick={() => setColor(color === c ? null : c)} className={cx("h-5 w-5 rounded-full border", color === c ? "ring-2 ring-accent" : "border-black/10")} style={{ background: c }} />
        ))}
        <IconButton label="Export highlights as Markdown" className="ml-auto h-8 w-8" onClick={exportMd} disabled={!list.length}>
          <Download size={15} />
        </IconButton>
      </div>
      {list.length === 0 && <p className="px-4 text-sm text-muted">Select text in the document to highlight it or add a note.</p>}
      <ul className="text-sm">
        {list.map((a) => (
          <li key={a.id} className="group border-b border-line px-3 py-2.5 last:border-0 hover:bg-panel-2">
            <button className="block w-full text-left" onClick={() => requestScroll(a.rects[0]?.page ?? a.page, a.rects[0]?.rect.y)}>
              <span className="line-clamp-3 border-l-4 pl-2 italic" style={{ borderColor: a.color }}>
                {a.quote}
              </span>
              {a.note && <span className="mt-1 block pl-3 text-[13px]">{a.note}</span>}
              <span className="mt-1 block pl-3 text-xs text-muted">Page {a.page}</span>
            </button>
            <div className="mt-1 flex gap-1 pl-2 opacity-0 group-hover:opacity-100">
              <IconButton label="Read this" className="h-7 w-7" onClick={() => void player.play(a.srcStart)}>
                <Play size={14} />
              </IconButton>
              <IconButton
                label="Edit note"
                className="h-7 w-7"
                onClick={() => {
                  const n = prompt("Note", a.note ?? "");
                  if (n !== null) void db.annotations.update(a.id, { note: n || undefined });
                }}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton label="Delete highlight" className="h-7 w-7" onClick={() => void db.annotations.delete(a.id)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Hit {
  page: number;
  srcStart: number;
  srcEnd: number;
  before: string;
  match: string;
  after: string;
}

export function SearchPanel() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const active = useReader((s) => s.activeHit);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setProgress(null);
      useReader.setState({ searchHits: [], activeHit: -1 });
      return;
    }
    const t = setTimeout(async () => {
      const s = getSession();
      if (!s) return;
      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
      const found: Hit[] = [];
      const n = s.pdf.numPages;
      for (let p = 1; p <= n; p++) {
        if (runId.current !== id) return;
        const pt = await s.text.getPageText(p);
        const display = buildDisplay([pt], { ...s.model.options, removeHeadersFooters: false, removePageNumbers: false, skipFootnotes: false, skipCaptions: false, skipTables: false });
        for (const m of display.text.matchAll(re)) {
          const [a, b] = display.toSrcRange(m.index!, m.index! + m[0].length);
          const t = display.text;
          found.push({ page: p, srcStart: a, srcEnd: b, before: t.slice(Math.max(0, m.index! - 40), m.index!), match: m[0], after: t.slice(m.index! + m[0].length, m.index! + m[0].length + 40) });
          if (found.length >= 1000) break;
        }
        if (p % 5 === 0 || p === n) {
          setHits([...found]);
          setProgress(p / n);
          useReader.setState({ searchHits: found.map(({ page, srcStart, srcEnd }) => ({ page, srcStart, srcEnd })) });
          await new Promise((r) => setTimeout(r, 0));
        }
        if (found.length >= 1000) break;
      }
      if (runId.current === id) {
        setProgress(null);
        setHits(found);
        useReader.setState({ searchHits: found.map(({ page, srcStart, srcEnd }) => ({ page, srcStart, srcEnd })), activeHit: found.length ? 0 : -1 });
        if (found.length) goTo(found, 0);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => () => useReader.setState({ searchHits: [], activeHit: -1 }), []);

  function goTo(list: Hit[], i: number) {
    const h = list[i];
    if (!h) return;
    useReader.setState({ activeHit: i });
    const r = getSession()?.model.rectsFor(h.srcStart, h.srcEnd)[0];
    requestScroll(h.page, r?.rect.y);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <input
          data-search-input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length) goTo(hits, (active + (e.shiftKey ? hits.length - 1 : 1)) % hits.length);
          }}
          placeholder="Search in document"
          aria-label="Search in document"
          className="h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-muted">
          <span>{q.trim().length >= 2 ? `${hits.length}${hits.length >= 1000 ? "+" : ""} result${hits.length === 1 ? "" : "s"}` : "Type at least 2 characters"}</span>
          {hits.length > 0 && <span>Enter / Shift+Enter to step</span>}
        </div>
        {progress !== null && <ProgressBar value={progress} className="mt-2" />}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto text-sm">
        {hits.map((h, i) => (
          <li key={i}>
            <button onClick={() => goTo(hits, i)} className={cx("block w-full px-3 py-2 text-left hover:bg-panel-2", i === active && "bg-accent-soft")}>
              <span className="text-xs text-muted">Page {h.page}</span>
              <span className="mt-0.5 block line-clamp-2">
                …{h.before}
                <mark className="rounded bg-yellow-300 px-0.5 text-black">{h.match}</mark>
                {h.after}…
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LibraryPanel() {
  const docId = useReader((s) => s.docId);
  const docs = useLiveQuery(() => db.documents.orderBy("lastOpenedAt").reverse().limit(30).toArray(), []) ?? [];
  return (
    <ul className="py-1 text-sm">
      {docs.map((d) => (
        <li key={d.id}>
          <button onClick={() => navigate({ name: "doc", id: d.id })} className={cx("block w-full px-3 py-2 text-left hover:bg-panel-2", d.id === docId && "bg-accent-soft text-accent")}>
            <span className="line-clamp-2">{d.title}</span>
            <span className="text-xs text-muted">
              {d.numPages} pages · {Math.round(d.progress * 100)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
