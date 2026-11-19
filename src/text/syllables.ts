/** Rough English syllable count used to weight word durations. */
export function syllables(word: string): number {
  const w = word.trim();
  if (!w) return 0;
  if (/^\d+([.,]\d+)?$/.test(w)) {
    const digits = w.replace(/\D/g, "").length;
    return Math.max(1, Math.round(digits * 1.4));
  }
  if (/^[A-Z]{2,5}s?$/.test(w)) return w.replace(/s$/, "").length; // acronyms are spelled out
  if (w.includes("-")) return w.split("-").reduce((s, p) => s + syllables(p), 0);
  const lw = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!lw) return 1;
  if (lw.length <= 3) return 1;
  const groups = lw.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
