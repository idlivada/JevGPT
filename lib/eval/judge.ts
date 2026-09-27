import { noul, type NoulResponse, score, type ScoreResponse, type TypeSafeClient } from "@typesafe-ai/sdk";
import { seededRng } from "../sampling";

export const FLUENCY_LEVELS = [
  "Word salad: not recognizable English",
  "Mostly broken: only short fragments are grammatical",
  "Partly grammatical, but awkward, repetitive, or contradictory",
  "Grammatical with minor awkwardness",
  "Fluent, natural English",
] as const;

export const RELEVANCE_LEVELS = [
  "Unrelated to the user's message",
  "Barely related: shares a topic word at most",
  "Related, but doesn't really answer the message",
  "Answers the message, but vaguely or only partly",
  "Directly and sensibly answers the message",
] as const;

/** Highest score level; scores run from 0 to this. */
export const MAX_SCORE = FLUENCY_LEVELS.length - 1;

export function buildJudgeQuestions() {
  return {
    fluency: score(
      "Judge only the language quality of assistant_reply, ignoring whether it answers the user. " +
        "How fluent and grammatical is it?",
      FLUENCY_LEVELS,
    ),
    relevance: score(
      "Judge whether assistant_reply is a sensible response to user_message, ignoring minor grammar mistakes.",
      RELEVANCE_LEVELS,
    ),
    complete: noul("assistant_reply ends as a complete sentence rather than stopping mid-thought"),
  };
}

export interface JudgeResult {
  /** Expected fluency level, 0–4 (fractional). */
  fluency: number;
  /** Expected relevance level, 0–4 (fractional). */
  relevance: number;
  /** Probability that the reply ends as a complete sentence. */
  complete: number;
  inputTokens: number;
}

/** One Jev request that grades a single reply. */
export async function judgeReply(
  client: TypeSafeClient,
  userMessage: string,
  reply: string,
  signal?: AbortSignal,
): Promise<JudgeResult> {
  const res = await client.systemOne(
    { state: { user_message: userMessage, assistant_reply: reply }, questions: buildJudgeQuestions() },
    { signal },
  );
  const answers = res.answers as unknown as {
    fluency: ScoreResponse;
    relevance: ScoreResponse;
    complete: NoulResponse;
  };
  return {
    fluency: answers.fluency.score,
    relevance: answers.relevance.score,
    complete: answers.complete.noul,
    inputTokens: res.usage?.input_tokens ?? 0,
  };
}

/** Shuffle a text's words with a fixed seed: a fluency control that keeps the vocabulary. */
export function shuffleWords(text: string, seed: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const rng = seededRng(seed);
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words.join(" ");
}
