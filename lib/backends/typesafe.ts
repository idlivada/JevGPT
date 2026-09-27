import { choice, type ChoiceQuestion, type ChoiceResponse, TypeSafeClient } from "@typesafe-ai/sdk";
import { MAX_HISTORY_MESSAGES } from "../defaults";
import { detokenize, formatToken } from "../detokenize";
import { normalize } from "../sampling";
import { END, type Vocab, vocab as defaultVocab } from "../vocab";
import type { DistributionResult, NextWordBackend, NextWordContext, RerankResult } from "./types";

const GROUP_QUESTION = "group";
const RERANK_QUESTION = "continuation";
const END_LABEL = "END";
/** Keep the state well under Jev's 32k-token per-question budget. */
const MAX_MESSAGE_CHARS = 2000;
/** How many trailing words of the reply to quote as the anchor for the next word. */
const ANCHOR_WORDS = 4;

const PERSONA =
  "You are JevGPT, a friendly and helpful chat assistant that writes its reply one word at a time. " +
  "Read the conversation and assistant_reply_so_far.";

const wordQuestionName = (groupId: string) => `g_${groupId}`;

interface Criteria {
  groups: Record<string, string>;
  words: Record<string, Record<string, string | null>>;
}

const criteriaCache = new WeakMap<Vocab, Criteria>();
const questionCache = new WeakMap<Vocab, Record<string, ChoiceQuestion>>();

/** Option lists for every question; they never change, so build them once per vocabulary. */
function buildCriteria(v: Vocab): Criteria {
  const cached = criteriaCache.get(v);
  if (cached) return cached;
  const groups: Record<string, string> = {};
  const words: Criteria["words"] = {};
  for (const g of v.groups) {
    groups[g.id] = g.description;
    words[g.id] = Object.fromEntries(g.words.map((w) => [w, g.descriptions[w] ?? null]));
  }
  groups[END_LABEL] = "nothing: the reply is already a complete, sensible answer, so stop here";
  const criteria = { groups, words };
  criteriaCache.set(v, criteria);
  return criteria;
}

/**
 * A sentence pinning down exactly where the next word goes, e.g.
 * `The assistant's reply so far is exactly: "I think". The next word comes right after "I think".`
 */
export function positionText(replySoFar: readonly string[]): string {
  if (replySoFar.length === 0) return "The assistant's reply hasn't started yet, so the next word is its first word.";
  const anchor = detokenize(replySoFar.slice(-ANCHOR_WORDS)).trimStart();
  return (
    `The assistant's reply so far is exactly: "${detokenize(replySoFar)}". ` +
    `The next word comes right after "${anchor}" and must continue it grammatically.`
  );
}

/**
 * The per-step questions: one "which kind of word?" question over the groups (+ END), and one
 * "which word?" question per group. Jev answers them all in a single request, which gives
 * P(word) = P(group) × P(word | group) over the whole vocabulary.
 *
 * With `position` (see positionText), every question also quotes the reply so far, so Jev knows
 * exactly which slot it is filling. Without it, the questions are static and cached.
 */
export function buildQuestions(v: Vocab, position?: string): Record<string, ChoiceQuestion> {
  if (position === undefined) {
    const cached = questionCache.get(v);
    if (cached) return cached;
  }
  const criteria = buildCriteria(v);
  const where = position ? `${position} ` : "";
  const questions: Record<string, ChoiceQuestion> = {
    [GROUP_QUESTION]: choice(
      `${PERSONA} ${where}What kind of word should come next in the assistant's reply so it stays fluent, ` +
        "grammatical, and responsive to the user's latest message? Choose END only when the reply is " +
        "a complete answer that already ends with punctuation.",
      criteria.groups,
    ),
  };
  for (const g of v.groups) {
    questions[wordQuestionName(g.id)] = choice(
      `${PERSONA} ${where}The next word of the assistant's reply is ${g.description}. Which word should it be ` +
        "so the reply stays fluent, grammatical, and relevant to the user's latest message?",
      criteria.words[g.id],
    );
  }
  if (position === undefined) questionCache.set(v, questions);
  return questions;
}

export function buildState(ctx: NextWordContext) {
  return {
    conversation: ctx.messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
      role: m.role,
      text: m.content.slice(0, MAX_MESSAGE_CHARS),
    })),
    assistant_reply_so_far: detokenize(ctx.replySoFar),
  };
}

/** Combine Jev's answers into one normalized distribution over words + END. */
export function combineAnswers(
  v: Vocab,
  answers: Record<string, Pick<ChoiceResponse, "probabilities">>,
): Map<string, number> {
  const groupProbs = answers[GROUP_QUESTION].probabilities as Record<string, number>;
  const probs = new Map<string, number>([[END, groupProbs[END_LABEL] ?? 0]]);
  for (const g of v.groups) {
    const pGroup = groupProbs[g.id] ?? 0;
    const wordProbs = answers[wordQuestionName(g.id)]?.probabilities as Record<string, number> | undefined;
    if (!wordProbs) continue;
    for (const [word, pWord] of Object.entries(wordProbs)) {
      // A word listed in several groups accumulates probability from each.
      probs.set(word, (probs.get(word) ?? 0) + pGroup * pWord);
    }
  }
  return new Map(normalize([...probs]));
}

/**
 * One question whose options are whole continuations ("I think", "I is", "I can", …) rather than
 * bare words, so Jev judges each candidate in context. Labels are the continuation texts; the map
 * translates them back to candidate words.
 */
export function buildRerankQuestion(replySoFar: readonly string[], candidates: readonly string[]) {
  const labelToWord = new Map<string, string>();
  const criteria: Record<string, string | null> = {};
  const replyText = detokenize(replySoFar);
  for (const word of candidates) {
    const label =
      word === END ? `${replyText || "(empty)"} [end of reply]` : replyText + formatToken(replySoFar, word);
    labelToWord.set(label, word);
    criteria[label] = null;
  }
  const question = choice(
    `${PERSONA} Each option is assistant_reply_so_far with one more word added, or the reply ending ` +
      "there ([end of reply]). Which option is the best way to continue the reply so it stays fluent, " +
      "grammatical, and responsive to the user's latest message?",
    criteria,
  );
  return { question, labelToWord };
}

export class TypeSafeBackend implements NextWordBackend {
  readonly kind = "typesafe" as const;
  readonly modelHint: string;
  private readonly client: TypeSafeClient;

  constructor(
    private readonly v: Vocab = defaultVocab,
    // Reads TYPESAFE_API_KEY, TYPESAFE_BASE_URL and TYPESAFE_DEFAULT_MODEL from the environment.
    client: TypeSafeClient = new TypeSafeClient(),
  ) {
    this.client = client;
    this.modelHint = client.defaultModel;
  }

  async distribution(ctx: NextWordContext, signal?: AbortSignal): Promise<DistributionResult> {
    const questions = buildQuestions(this.v, ctx.quoteReply ? positionText(ctx.replySoFar) : undefined);
    const res = await this.client.systemOne({ state: buildState(ctx), questions }, { signal });
    const answers = res.answers as unknown as Record<string, ChoiceResponse>;
    return { probs: combineAnswers(this.v, answers), model: res.model, inputTokens: res.usage?.input_tokens };
  }

  async rerank(ctx: NextWordContext, candidates: string[], signal?: AbortSignal): Promise<RerankResult> {
    const { question, labelToWord } = buildRerankQuestion(ctx.replySoFar, candidates);
    const res = await this.client.systemOne(
      { state: buildState(ctx), questions: { [RERANK_QUESTION]: question } },
      { signal },
    );
    const answer = res.answers[RERANK_QUESTION] as unknown as ChoiceResponse;
    const probs = new Map<string, number>();
    for (const [label, p] of Object.entries(answer.probabilities as Record<string, number>)) {
      const word = labelToWord.get(label);
      if (word !== undefined) probs.set(word, p);
    }
    return { probs: new Map(normalize([...probs])), inputTokens: res.usage?.input_tokens };
  }
}
