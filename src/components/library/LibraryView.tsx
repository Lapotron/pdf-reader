import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, FileUp, Search, Settings, Sparkles, Trash2, HardDrive } from "lucide-react";
import { db, type DocumentRow } from "../../db/schema";
import { deleteDocument, importPdf } from "../../db/library";
import { navigate } from "../../app/useHashRoute";
import { toast } from "../../app/toast";
import { Button, IconButton, ProgressBar, cx } from "../ui";
import { SettingsDialog } from "../settings/SettingsDialog";

function Thumb({ docId }: { docId: string }) {
  const row = useLiveQuery(() => db.thumbnails.get([docId, 1]), [docId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!row?.blob) return;
    const u = URL.createObjectURL(row.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [row]);
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-muted">
      <BookOpen size={28} />
    </div>
  );
}

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function LibraryView() {
  const docs = useLiveQuery(() => db.documents.orderBy("lastOpenedAt").reverse().toArray(), []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Library · Mega Reader";
    navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {});
  }, [docs?.length]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (docs ?? []).filter((d) => !s || d.title.toLowerCase().includes(s) || d.fileName.toLowerCase().includes(s) || d.author?.toLowerCase().includes(s));
  }, [docs, q]);

  async function openFiles(files: FileList | File[]) {
    const pdfs = [...files].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) {
      toast("Please choose a PDF file.", "error");
      return;
    }
    setBusy(true);
    try {
      let last = "";
      for (const f of pdfs) last = await importPdf(f, f.name);
      if (pdfs.length === 1) navigate({ name: "doc", id: last });
      else toast(`Added ${pdfs.length} documents.`, "success");
    } catch (e) {
      toast(`Could not open the PDF: ${(e as Error).message}`, "error", 7000);
    } finally {
      setBusy(false);
    }
  }

  async function openSample() {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample.pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const id = await importPdf(await res.blob(), "Welcome to Mega Reader.pdf");
      navigate({ name: "doc", id });
    } catch (e) {
      toast(`Could not load the sample: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: DocumentRow) {
    if (!confirm(`Remove “${d.title}” from your library? Notes, highlights and cached audio for it are deleted too.`)) return;
    await deleteDocument(d.id);
    toast("Removed from library.");
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void openFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-8 w-8 rounded-lg" />
        <h1 className="text-lg font-semibold tracking-tight">Mega Reader</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search library"
              aria-label="Search library"
              className="h-9 w-56 rounded-lg border border-line bg-panel-2 pl-8 pr-3 text-sm"
            />
          </div>
          <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={busy} data-testid="open-pdf">
            <FileUp size={16} /> Open PDF
          </Button>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </IconButton>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files?.length) void openFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <main className="relative min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-6">
        {busy && (
          <div className="mx-auto mb-4 max-w-md">
            <ProgressBar value={null} />
            <p className="mt-2 text-center text-sm text-muted">Opening…</p>
          </div>
        )}
        {docs && docs.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border-2 border-dashed border-line bg-panel p-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <FileUp size={28} />
            </div>
            <h2 className="text-xl font-semibold">Drop a PDF here to start listening</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Natural neural voices read your document aloud while a floating reading line keeps your place. Everything stays on your device.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => fileInput.current?.click()}>
                <FileUp size={16} /> Choose a PDF
              </Button>
              <Button onClick={openSample} data-testid="open-sample">
                <Sparkles size={16} /> Try the sample
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted">
                {filtered.length} document{filtered.length === 1 ? "" : "s"}
              </h2>
              <Button size="sm" variant="ghost" onClick={openSample}>
                <Sparkles size={14} /> Sample document
              </Button>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
              {filtered.map((d) => (
                <li key={d.id} className="group relative">
                  <button
                    onClick={() => navigate({ name: "doc", id: d.id })}
                    className="block w-full overflow-hidden rounded-xl border border-line bg-panel text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    data-testid="library-item"
                  >
                    <div className="aspect-[3/4] overflow-hidden border-b border-line bg-white">
                      <Thumb docId={d.id} />
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{d.title}</p>
                      <p className="mt-1 text-xs text-muted">
                        {d.numPages} pages · {timeAgo(d.lastOpenedAt)}
                      </p>
                      <ProgressBar value={d.progress} className="mt-2 !h-1" />
                    </div>
                  </button>
                  <IconButton
                    label={`Remove ${d.title}`}
                    onClick={() => remove(d)}
                    className={cx("absolute right-2 top-2 bg-panel/90 opacity-0 shadow group-hover:opacity-100 focus:opacity-100")}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
        {drag && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/60 text-lg font-medium text-accent">
            Drop PDF to open
          </div>
        )}
      </main>
      {usage && usage.quota > 0 && (
        <footer className="flex items-center gap-2 border-t border-line bg-panel px-6 py-2 text-xs text-muted">
          <HardDrive size={14} /> Using {fmtBytes(usage.usage)} of {fmtBytes(usage.quota)} available browser storage
        </footer>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
