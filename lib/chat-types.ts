import type { Alternative } from "./sampling";

/** One generated word as streamed from /api/chat. */
export interface TokenInfo {
  word: string;
  /** Word with its leading space and capitalization applied. */
  display: string;
  /** Probability Jev assigned to this word. */
  p: number;
  /** Jev's top choices at this step (may include "<END>"). */
  alternatives: Alternative[];
  /** Chosen by re-ranking whole continuations; p and alternatives are the re-rank probabilities. */
  reranked?: boolean;
}

export type MessageStatus = "streaming" | "done" | "max_words" | "stopped" | "error";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens?: TokenInfo[];
  status?: MessageStatus;
  error?: string;
  model?: string;
}

export interface BackendInfo {
  /** Null until the user enters an API key: the chat is locked. */
  backend: "typesafe" | "mock" | null;
  model?: string;
  /** "user" when a key was entered in the UI, otherwise null. */
  keySource?: "user" | null;
  /** Masked key, e.g. "api…a1b2". */
  keyHint?: string;
  /** The server forces the mock backend (JEV_BACKEND=mock). */
  forcedMock?: boolean;
  vocabSize?: number;
  groups?: number;
}

export interface UiSettings {
  temperature: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
  maxWords: number;
  heatmap: boolean;
  /** Send earlier messages as context, or only the latest one. */
  useHistory: boolean;
  /** Let Jev choose among the top whole continuations each step (about 2x slower). */
  rerank: boolean;
}
