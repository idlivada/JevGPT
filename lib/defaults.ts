export interface SamplingSettings {
  /** <1 sharpens the distribution, >1 flattens it. */
  temperature: number;
  /** Keep only the K most likely words (0 disables). */
  topK: number;
  /** Keep the smallest set of words whose probability mass reaches P. */
  topP: number;
  /** Divide a word's probability by this for each time it already appears in the reply. */
  repetitionPenalty: number;
}

export const DEFAULT_SETTINGS: SamplingSettings = {
  temperature: 0.8,
  topK: 40,
  topP: 0.95,
  repetitionPenalty: 1.3,
};

/** Default cap on reply length, in words. */
export const DEFAULT_MAX_WORDS = 60;

/** Shortlist size when re-ranking is on: the size that won the coherence eval. */
export const DEFAULT_RERANK_CANDIDATES = 12;

/** How many recent messages Jev sees when chat history is on. */
export const MAX_HISTORY_MESSAGES = 8;

/**
 * URL prefix when the app is served under a sub-path, e.g. "/jevgpt" (NEXT_PUBLIC_BASE_PATH, also
 * the Next.js basePath). fetch() and cookie paths don't get the prefix automatically, so add it.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
