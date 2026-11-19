import { describe, expect, it } from "vitest";
import { MappedString } from "./mappedString";

const isMonotonic = (m: Float64Array) => m.every((v, i) => i === 0 || v >= m[i - 1]);

describe("MappedString", () => {
  it("identity maps each char to base + i", () => {
    const ms = MappedString.identity("hello", 100);
    expect(Array.from(ms.map)).toEqual([100, 101, 102, 103, 104, 105]);
    expect(ms.toSrcRange(1, 3)).toEqual([101, 103]);
  });

  it("delete keeps the original mapping of surviving chars", () => {
    const ms = MappedString.identity("experi-\nment", 0).deleteAll(/-\n/g);
    expect(ms.text).toBe("experiment");
    expect(ms.toSrcRange(0, ms.length)).toEqual([0, 12]);
    expect(ms.map[6]).toBe(8); // 'm' of "ment"
  });

  it("spreads replacements over the replaced source range", () => {
    const ms = MappedString.identity("use SQL now", 0).replaceAll(/SQL/g, "sequel");
    expect(ms.text).toBe("use sequel now");
    expect(ms.toSrcRange(4, 10)).toEqual([4, 7]);
    expect(isMonotonic(ms.map)).toBe(true);
  });

  it("expands $1 groups and handles insertion", () => {
    const ms = MappedString.identity("Smith John", 0).replaceAll(/(\w+) (\w+)/g, "$2 $1");
    expect(ms.text).toBe("John Smith");
    expect(isMonotonic(ms.map)).toBe(true);
    const ins = MappedString.identity("ab", 0).edit([{ start: 1, end: 1, text: "XY" }]);
    expect(ins.text).toBe("aXYb");
    expect(Array.from(ins.map)).toEqual([0, 1, 1, 1, 2]);
  });

  it("composes stages back to the original source", () => {
    const s1 = MappedString.identity("e.g. the cat [12] sat", 0);
    const s2 = s1.deleteAll(/ \[\d+\]/g);
    const s3 = s2.replaceAll(/e\.g\./g, "for example");
    expect(s3.text).toBe("for example the cat sat");
    const i = s3.text.indexOf("sat");
    expect(s3.toSrcRange(i, i + 3)).toEqual([18, 21]);
  });

  it("concat maps separators to the previous part end", () => {
    const a = MappedString.identity("ab", 10);
    const b = MappedString.identity("cd", 50);
    const c = MappedString.concat([a, b], ["\n"]);
    expect(c.text).toBe("ab\ncd");
    expect(Array.from(c.map)).toEqual([10, 11, 12, 50, 51, 52]);
  });

  it("toOut finds the first output char at or after a source position", () => {
    const ms = MappedString.identity("abc [1] def", 0).deleteAll(/ \[\d\]/g);
    expect(ms.text).toBe("abc def");
    expect(ms.toOut(4)).toBe(3); // deleted region resolves to the next surviving char
    expect(ms.toOut(8)).toBe(4);
  });

  it("random edit sequences keep the map monotonic and round-trip", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 200; trial++) {
      const base = "The quick brown fox jumps over the lazy dog. ".repeat(3);
      let ms = MappedString.identity(base, 1000);
      for (let step = 0; step < 6; step++) {
        const n = ms.length;
        if (n === 0) break;
        const s = Math.floor(rnd() * n);
        const e = Math.min(n, s + Math.floor(rnd() * 6));
        const t = "xyz".slice(0, Math.floor(rnd() * 4));
        ms = ms.edit([{ start: s, end: e, text: t }]);
        expect(isMonotonic(ms.map)).toBe(true);
      }
      for (let i = 0; i < ms.length; i++) {
        const [a] = ms.toSrcRange(i, i + 1);
        expect(ms.toOut(a)).toBeLessThanOrEqual(i);
      }
    }
  });
});
