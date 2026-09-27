import type { ChatMessage, NextWordBackend } from "./backends/types";
import { formatToken } from "./detokenize";
import {
  type Alternative,
  DEFAULT_MAX_WORDS,
  DEFAULT_SETTINGS,
  type Rng,
  type SamplingSettings,
  sampleNextWord,
} from "./sampling";
import { END } from "./vocab";

export const MAX_MAX_WORDS = 200;

export interface GenerationSettings extends SamplingSettings {
  maxWords: number;
}

const clamp = (x: unknown, lo: number, hi: number, fallback: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

/** Fill in defaults and clamp untrusted settings (from a request body or an eval config). */
export function resolveSettings(s: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    temperature: clamp(s.temperature, 0.05, 2, DEFAULT_SETTINGS.temperature),
    topK: Math.round(clamp(s.topK, 0, 500, DEFAULT_SETTINGS.topK)),
    topP: clamp(s.topP, 0.05, 1, DEFAULT_SETTINGS.topP),
    repetitionPenalty: clamp(s.repetitionPenalty, 1, 3, DEFAULT_SETTINGS.repetitionPenalty),
    maxWords: Math.round(clamp(s.maxWords, 1, MAX_MAX_WORDS, DEFAULT_MAX_WORDS)),
  };
}

export type GenerationEvent =
  | { type: "meta"; backend: NextWordBackend["kind"]; model: string }
  | { type: "token"; word: string; display: string; p: number; alternatives: Alternative[] }
  | { type: "done"; reason: "end" | "max_words"; inputTokens: number };

export interface GenerateOptions {
  backend: NextWordBackend;
  messages: ChatMessage[];
  settings: GenerationSettings;
  rng?: Rng;
  signal?: AbortSignal;
}

/**
 * The autoregressive loop: ask the backend for a next-word distribution, sample one word, append
 * it, repeat until END or maxWords. Emits a meta event first and again whenever the model changes.
 */
export async function* generateReply({
  backend,
  messages,
  settings,
  rng = Math.random,
  signal,
}: GenerateOptions): AsyncGenerator<GenerationEvent> {
  let model = backend.modelHint;
  yield { type: "meta", backend: backend.kind, model };
  const reply: string[] = [];
  let inputTokens = 0;
  while (reply.length < settings.maxWords) {
    signal?.throwIfAborted();
    const dist = await backend.distribution({ messages, replySoFar: reply }, signal);
    inputTokens += dist.inputTokens ?? 0;
    if (dist.model !== model) {
      model = dist.model;
      yield { type: "meta", backend: backend.kind, model };
    }
    const next = sampleNextWord(dist.probs, reply, settings, rng);
    if (next.word === END) {
      yield { type: "done", reason: "end", inputTokens };
      return;
    }
    yield {
      type: "token",
      word: next.word,
      display: formatToken(reply, next.word),
      p: next.p,
      alternatives: next.alternatives,
    };
    reply.push(next.word);
  }
  yield { type: "done", reason: "max_words", inputTokens };
}
