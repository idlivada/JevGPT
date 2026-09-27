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
}

export interface DistributionResult {
  /** Probability of each vocabulary word (and END) being next; sums to ~1. */
  probs: Distribution;
  /** Model that produced the distribution, e.g. "jev-1.13.0" or "mock-trigram". */
  model: string;
}

export interface NextWordBackend {
  readonly kind: "typesafe" | "mock";
  /** Model name to show before the first request completes. */
  readonly modelHint: string;
  distribution(ctx: NextWordContext, signal?: AbortSignal): Promise<DistributionResult>;
}
