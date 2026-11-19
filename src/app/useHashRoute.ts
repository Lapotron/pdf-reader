import { useSyncExternalStore } from "react";

export type Route = { name: "library" } | { name: "doc"; id: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const m = /^doc\/([0-9a-f]{16,64})/.exec(h);
  return m ? { name: "doc", id: m[1] } : { name: "library" };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useHashRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(r: Route): void {
  location.hash = r.name === "doc" ? `#/doc/${r.id}` : "#/";
}
