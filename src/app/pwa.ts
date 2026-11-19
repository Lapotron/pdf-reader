import { create } from "zustand";
import { importPdf } from "../db/library";
import { navigate } from "./useHashRoute";
import { toast } from "./toast";

export const usePwa = create<{ needRefresh: boolean; update: (() => Promise<void>) | null }>()(() => ({ needRefresh: false, update: null }));

/** Registers the service worker (production builds) and handles OS "open with" PDF launches. */
export async function initPwa(): Promise<void> {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    try {
      const { registerSW } = await import("virtual:pwa-register");
      const update = registerSW({
        onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
        onOfflineReady: () => toast("Simple Reader is ready to work offline."),
      });
      usePwa.setState({ update: () => update(true) });
    } catch (e) {
      console.warn("Service worker registration failed", e);
    }
  }
  // File Handling API: installed app opened from a PDF file.
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  lq?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    try {
      const file = await files[0].getFile();
      navigate({ name: "doc", id: await importPdf(file, file.name) });
    } catch (e) {
      toast(`Could not open the file: ${(e as Error).message}`, "error");
    }
  });
}
