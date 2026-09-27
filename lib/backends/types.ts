import type { Distribution } from "../sampling";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface NextWordContext {
  /** Conversation so far, ending with the user's latest message. */
  messages: ChatMessage[];
  /** Words the assistant has generated so far in the current reply. */
  replySoFar: string[];
  /** Quote the reply so far in every question so Jev knows exactly which slot it's filling. */
  quoteReply?: boolean;
}

export interface DistributionResult {
  /** Probability of each vocabulary word (and END) being next; sums to ~1. */
  probs: Distribution;
  /** Model that produced the distribution, e.g. "jev-1.13.0" or "mock-trigram". */
  model: string;
  /** Input tokens billed for this step (Jev only). */
  inputTokens?: number;
}

export interface RerankResult {
  /** Probability of each candidate being the best continuation; sums to ~1. */
  probs: Distribution;
  inputTokens?: number;
}

export interface NextWordBackend {
  readonly kind: "typesafe" | "mock";
  /** Model name to show before the first request completes. */
  readonly modelHint: string;
  distribution(ctx: NextWordContext, signal?: AbortSignal): Promise<DistributionResult>;
  /** Judge a short list of candidate next words (and possibly END) as whole continuations. */
  rerank?(ctx: NextWordContext, candidates: string[], signal?: AbortSignal): Promise<RerankResult>;
}
