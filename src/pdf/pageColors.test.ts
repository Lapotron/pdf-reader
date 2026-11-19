import { describe, expect, it } from "vitest";
import { allFilterSpecs, contrastRatio, filterId, filterSpec, getPageColorSet, isDarkSet, PAGE_COLOR_SETS, resolvePageColors } from "./pageColors";

describe("page color sets", () => {
  it("every set keeps text comfortably readable (WCAG AAA, >= 7:1)", () => {
    for (const s of PAGE_COLOR_SETS) expect(contrastRatio(s.ink, s.paper), s.id).toBeGreaterThanOrEqual(7);
  });

  it("dark sets avoid harsh maximum contrast (halation), except high contrast", () => {
    for (const s of PAGE_COLOR_SETS.filter((x) => isDarkSet(x) && x.id !== "high-contrast")) expect(contrastRatio(s.ink, s.paper), s.id).toBeLessThanOrEqual(15);
  });

  it("auto follows the app theme", () => {
    expect(resolvePageColors("auto", "dark").id).toBe("soft-dark");
    expect(resolvePageColors("auto", "light").id).toBe("original");
    expect(resolvePageColors("auto", "sepia").id).toBe("sepia");
    expect(resolvePageColors("oled", "light").id).toBe("oled");
    expect(resolvePageColors("nope", "dark").id).toBe("original");
  });

  it("builds the right filter recipes", () => {
    expect(filterId(getPageColorSet("original"), "keep")).toBeNull();
    expect(filterId(getPageColorSet("soft-dark"), "keep")).toBe("pc-soft-dark-keep");
    const keepDark = filterSpec(getPageColorSet("oled"), "keep")!;
    expect(keepDark.invertHue).toBe(true);
    expect(keepDark.from).toEqual([0, 0, 0]); // inverted white (0) → paper (black)
    const duo = filterSpec(getPageColorSet("oled"), "duotone")!;
    expect(duo.luminance).toBe(true);
    expect(duo.to).toEqual([0, 0, 0]); // luminance 1 (white) → paper
    const sepia = filterSpec(getPageColorSet("sepia"), "keep")!;
    expect(sepia.invertHue).toBe(false);
    expect(allFilterSpecs()).toHaveLength((PAGE_COLOR_SETS.length - 1) * 2);
  });
});
