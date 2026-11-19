import { useEffect } from "react";
import { closeDocument, openDocument } from "../../app/session";
import { useShortcuts } from "../../app/shortcuts";
import { navigate } from "../../app/useHashRoute";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { TopBar } from "../layout/TopBar";
import { Sidebar } from "../layout/Sidebar";
import { PlayerBar } from "../layout/PlayerBar";
import { HelpDialog } from "../layout/HelpDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { ExportDialog } from "../player/ExportDialog";
import { DocumentView } from "./DocumentView";
import { Button, ProgressBar } from "../ui";

export function ReaderView({ docId }: { docId: string }) {
  const loading = useReader((s) => s.loading);
  const error = useReader((s) => s.loadError);
  const title = useReader((s) => s.title);
  const sidebarOpen = useSettings((s) => s.ui.sidebarOpen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  useShortcuts();

  useEffect(() => {
    if (window.innerWidth < 768) useSettings.getState().set("ui", { sidebarOpen: false });
    void openDocument(docId);
    return () => closeDocument();
  }, [docId]);

  useEffect(() => {
    if (title) document.title = `${title} · Mega Reader`;
  }, [title]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-lg font-medium">Could not open this document</p>
            <p className="max-w-md text-sm text-muted">{error}</p>
            <Button onClick={() => navigate({ name: "library" })}>Back to library</Button>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-64">
              <ProgressBar value={null} />
              <p className="mt-2 text-center text-sm text-muted">Opening document…</p>
            </div>
          </div>
        ) : (
          <DocumentView />
        )}
      </div>
      <PlayerBar />
      <SettingsDialog open={settingsOpen} onClose={() => useUi.setState({ settingsOpen: false })} />
      <ExportDialog />
      <HelpDialog />
    </div>
  );
}
