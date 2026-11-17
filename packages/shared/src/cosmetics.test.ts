import { describe, expect, it } from "vitest";
import { cleanCosmetics, COSMETIC_MASK, COSMETICS } from "./cosmetics";

describe("cosmetics", () => {
  it("every item has its own id and its own single bit", () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    expect(new Set(COSMETICS.map((c) => c.bit)).size).toBe(COSMETICS.length);
    for (const c of COSMETICS) {
      expect(c.bit & (c.bit - 1)).toBe(0);
      expect(c.id).toMatch(/^[a-z]{1,24}$/); // the saved-progress check only accepts these keys
      expect(c.price).toBeGreaterThan(0);
      expect(c.days).toBeGreaterThan(0);
    }
  });

  it("cleans masks from the wire", () => {
    expect(cleanCosmetics(COSMETIC_MASK)).toBe(COSMETIC_MASK);
    expect(cleanCosmetics(0xffff)).toBe(COSMETIC_MASK);
    expect(cleanCosmetics(3)).toBe(3);
    for (const bad of [undefined, null, "3", 1.5, NaN, {}]) expect(cleanCosmetics(bad)).toBe(0);
  });
});
