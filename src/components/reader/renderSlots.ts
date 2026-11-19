/** Limits concurrent canvas renders (pdf.js work is heavy). */
let active = 0;
const MAX = 2;
const waiting: (() => void)[] = [];

export function acquireRenderSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active--;
        waiting.shift()?.();
      });
    };
    if (active < MAX) grant();
    else waiting.push(grant);
  });
}
