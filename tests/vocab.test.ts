import { describe, expect, it } from "vitest";
import { END, MAX_CHOICE_OPTIONS, parseVocab, vocab } from "@/lib/vocab";

describe("vocab", () => {
  it("loads the shipped vocabulary within Jev's limits", () => {
    expect(vocab.groups.length).toBeGreaterThan(5);
    expect(vocab.words.length).toBeGreaterThan(1500);
    for (const g of vocab.groups) {
      expect(g.words.length, g.id).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
      expect(new Set(g.words).size, g.id).toBe(g.words.length);
    }
    expect(vocab.wordSet.has(END)).toBe(false);
  });

  const group = (id: string, words: string) => ({ id, description: id, words });

  it("rejects a group with more than 255 words", () => {
    const words = Array.from({ length: 256 }, (_, i) => `w${i}`).join(" ");
    expect(() => parseVocab({ groups: [group("big", words)] })).toThrow(/max 255/);
  });

  it("rejects duplicates within a group, but allows them across groups", () => {
    expect(() => parseVocab({ groups: [group("a", "x y x")] })).toThrow(/twice/);
    const v = parseVocab({ groups: [group("a", "x y"), group("b", "x z")] });
    expect(v.words.sort()).toEqual(["x", "y", "z"]);
  });

  it("rejects the reserved END token and bad group ids", () => {
    expect(() => parseVocab({ groups: [group("a", `x ${END}`)] })).toThrow(/reserved/);
    expect(() => parseVocab({ groups: [group("Bad-Id", "x y")] })).toThrow(/Invalid group id/);
  });
});
