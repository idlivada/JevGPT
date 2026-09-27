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

/** How many recent messages Jev sees when chat history is on. */
export const MAX_HISTORY_MESSAGES = 8;
