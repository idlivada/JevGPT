import { describe, expect, it } from "vitest";
import { detokenize, formatToken } from "@/lib/detokenize";

describe("detokenize", () => {
  it("spaces words and attaches punctuation", () => {
    expect(detokenize(["hello", ",", "I'm", "JevGPT", "!"])).toBe("Hello, I'm JevGPT!");
  });

  it("capitalizes the start of each sentence", () => {
    expect(detokenize(["sure", ".", "what", "else", "?", "ok"])).toBe("Sure. What else? Ok");
  });

  it("handles possessive 's, ellipsis, and dashes", () => {
    expect(detokenize(["it", "is", "Jev", "'s", "idea", "..."])).toBe("It is Jev's idea...");
    expect(detokenize(["fast", "-", "cheap"])).toBe("Fast - cheap");
  });

  it("formats a single token relative to its predecessors", () => {
    expect(formatToken([], "hello")).toBe("Hello");
    expect(formatToken(["hello"], "world")).toBe(" world");
    expect(formatToken(["hello"], ",")).toBe(",");
    expect(formatToken(["hi", "!"], "how")).toBe(" How");
  });
});
