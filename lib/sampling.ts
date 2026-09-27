import type { SamplingSettings } from "./defaults";
import { isPunctuation } from "./detokenize";
import { END } from "./vocab";

export { DEFAULT_MAX_WORDS, DEFAULT_SETTINGS, type SamplingSettings } from "./defaults";

export type Distribution = Map<string, number>;

export interface Alternative {
  word: string;
  p: number;
}

export interface SampleResult {
  word: string;
  /** Probability of the chosen word under the raw (unadjusted) model distribution. */
  p: number;
  /** Most likely words under the raw model distribution. */
  alternatives: Alternative[];
}

export type Rng = () => number;

/** Deterministic PRNG for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalize(entries: [string, number][]): [string, number][] {
  const total = entries.reduce((s, [, p]) => s + p, 0);
  if (!(total > 0)) return entries;
  return entries.map(([w, p]) => [w, p / total]);
}

export function topAlternatives(dist: Distribution, n = 5): Alternative[] {
  return [...dist]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, p]) => ({ word, p }));
}

/**
 * Turn the model's raw distribution into the one we actually sample from:
 * structural masks, repetition penalty, temperature, then top-k / top-p truncation.
 */
export function adjustDistribution(
  dist: Distribution,
  replySoFar: readonly string[],
  settings: SamplingSettings,
): [string, number][] {
  const prev = replySoFar.at(-1);
  const counts = new Map<string, number>();
  for (const w of replySoFar) counts.set(w, (counts.get(w) ?? 0) + 1);

  let entries: [string, number][] = [];
  for (const [word, p] of dist) {
    if (p <= 0) continue;
    // A reply can't be empty, can't open with punctuation, and punctuation can't follow punctuation.
    if (replySoFar.length === 0 && (word === END || isPunctuation(word))) continue;
    if (prev !== undefined && isPunctuation(prev) && isPunctuation(word)) continue;
    // Never repeat the exact previous word ("the the").
    if (word === prev) continue;
    let q = p;
    const seen = counts.get(word) ?? 0;
    if (seen > 0 && !isPunctuation(word)) q /= settings.repetitionPenalty ** seen;
    entries.push([word, q]);
  }
  // If masking removed everything, fall back to the raw distribution.
  if (entries.length === 0) entries = [...dist].filter(([, p]) => p > 0);

  const t = Math.max(settings.temperature, 1e-3);
  entries = entries.map(([w, p]) => [w, p ** (1 / t)]);
  entries.sort((a, b) => b[1] - a[1]);
  if (settings.topK > 0) entries = entries.slice(0, settings.topK);
  entries = normalize(entries);

  if (settings.topP < 1) {
    let mass = 0;
    const kept: [string, number][] = [];
    for (const e of entries) {
      kept.push(e);
      mass += e[1];
      if (mass >= settings.topP) break;
    }
    entries = normalize(kept);
  }
  return entries;
}

export function sampleFrom(entries: [string, number][], rng: Rng): string {
  let r = rng();
  for (const [w, p] of entries) {
    r -= p;
    if (r <= 0) return w;
  }
  return entries[entries.length - 1][0];
}

export function sampleNextWord(
  dist: Distribution,
  replySoFar: readonly string[],
  settings: SamplingSettings,
  rng: Rng = Math.random,
): SampleResult {
  const word = sampleFrom(adjustDistribution(dist, replySoFar, settings), rng);
  return { word, p: dist.get(word) ?? 0, alternatives: topAlternatives(dist) };
}
