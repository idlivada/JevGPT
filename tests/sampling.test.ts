import { describe, expect, it } from "vitest";
import {
  adjustDistribution,
  DEFAULT_SETTINGS,
  type Distribution,
  sampleNextWord,
  seededRng,
  type SamplingSettings,
} from "@/lib/sampling";
import { END } from "@/lib/vocab";

const dist = (o: Record<string, number>): Distribution => new Map(Object.entries(o));
const plain: SamplingSettings = { temperature: 1, topK: 0, topP: 1, repetitionPenalty: 1 };
const words = (e: [string, number][]) => e.map(([w]) => w);
const sum = (e: [string, number][]) => e.reduce((s, [, p]) => s + p, 0);

describe("adjustDistribution", () => {
  const d = dist({ the: 0.5, a: 0.3, cat: 0.15, dog: 0.05 });

  it("renormalizes and keeps order with neutral settings", () => {
    const e = adjustDistribution(d, ["hi"], plain);
    expect(words(e)).toEqual(["the", "a", "cat", "dog"]);
    expect(sum(e)).toBeCloseTo(1);
  });

  it("top-k keeps only the k most likely words", () => {
    expect(words(adjustDistribution(d, ["hi"], { ...plain, topK: 2 }))).toEqual(["the", "a"]);
  });

  it("top-p keeps the smallest set covering p", () => {
    expect(words(adjustDistribution(d, ["hi"], { ...plain, topP: 0.8 }))).toEqual(["the", "a"]);
    expect(words(adjustDistribution(d, ["hi"], { ...plain, topP: 0.81 }))).toEqual(["the", "a", "cat"]);
  });

  it("low temperature sharpens, high temperature flattens", () => {
    const cold = adjustDistribution(d, ["hi"], { ...plain, temperature: 0.2 });
    const hot = adjustDistribution(d, ["hi"], { ...plain, temperature: 2 });
    expect(cold[0][1]).toBeGreaterThan(0.9);
    expect(hot[0][1]).toBeLessThan(0.5);
  });

  it("does not end or start with punctuation on the first word", () => {
    const e = adjustDistribution(dist({ [END]: 0.6, ".": 0.3, hello: 0.1 }), [], plain);
    expect(words(e)).toEqual(["hello"]);
  });

  it("blocks punctuation after punctuation and immediate repeats", () => {
    expect(words(adjustDistribution(dist({ ",": 0.5, ".": 0.3, so: 0.2 }), ["yes", "."], plain))).toEqual(["so"]);
    expect(words(adjustDistribution(dist({ very: 0.9, good: 0.1 }), ["very"], plain))).toEqual(["good"]);
  });

  it("penalizes words already used in the reply", () => {
    const e = adjustDistribution(dist({ cat: 0.5, dog: 0.5 }), ["cat", "and"], { ...plain, repetitionPenalty: 2 });
    expect(words(e)[0]).toBe("dog");
    expect(e[0][1]).toBeCloseTo(2 / 3);
  });

  it("falls back to the raw distribution when everything is masked", () => {
    expect(words(adjustDistribution(dist({ [END]: 1 }), [], plain))).toEqual([END]);
  });
});

describe("sampleNextWord", () => {
  const d = dist({ the: 0.5, a: 0.3, cat: 0.15, dog: 0.05 });

  it("is deterministic with a seeded rng", () => {
    const run = () => Array.from({ length: 10 }, (_, i) => sampleNextWord(d, [], DEFAULT_SETTINGS, seededRng(i)).word);
    expect(run()).toEqual(run());
  });

  it("reports the raw probability and top alternatives", () => {
    const r = sampleNextWord(d, [], { ...plain, topK: 1 });
    expect(r).toMatchObject({ word: "the", p: 0.5 });
    expect(r.alternatives.map((a) => a.word)).toEqual(["the", "a", "cat", "dog"]);
  });

  it("samples roughly in proportion to probability", () => {
    const rng = seededRng(42);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) {
      const w = sampleNextWord(d, ["x"], plain, rng).word;
      counts[w] = (counts[w] ?? 0) + 1;
    }
    expect(counts.the / 5000).toBeCloseTo(0.5, 1);
    expect(counts.dog / 5000).toBeCloseTo(0.05, 1);
  });
});
