import type { Player, PlayerState } from "./player";

/** Hardware media keys / OS media controls → player actions. */
export function bindMediaSession(player: Player, title: () => string, onPlay: () => void): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action: MediaSessionAction, fn: () => void) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* unsupported action */
    }
  };
  set("play", onPlay);
  set("pause", () => player.pause());
  set("stop", () => player.stop());
  set("nexttrack", () => void player.next());
  set("previoustrack", () => void player.prev());
  set("seekforward", () => void player.next());
  set("seekbackward", () => void player.prev());
  player.on("state", (s: PlayerState) => {
    ms.playbackState = s === "playing" || s === "buffering" ? "playing" : s === "paused" ? "paused" : "none";
    if (s === "playing" || s === "loading") {
      try {
        ms.metadata = new MediaMetadata({ title: title() || "Document", artist: "Mega Reader", album: "Read aloud" });
      } catch {
        /* MediaMetadata unsupported */
      }
    }
  });
}
