import { choice, type ChoiceQuestion, type ChoiceResponse, TypeSafeClient } from "@typesafe-ai/sdk";
import { MAX_HISTORY_MESSAGES } from "../defaults";
import { detokenize } from "../detokenize";
import { normalize } from "../sampling";
import { END, type Vocab, vocab as defaultVocab } from "../vocab";
import type { DistributionResult, NextWordBackend, NextWordContext } from "./types";

const GROUP_QUESTION = "group";
const END_LABEL = "END";
/** Keep the state well under Jev's 32k-token per-question budget. */
const MAX_MESSAGE_CHARS = 2000;

const PERSONA =
  "You are JevGPT, a friendly and helpful chat assistant that writes its reply one word at a time. " +
  "Read the conversation and assistant_reply_so_far.";

const wordQuestionName = (groupId: string) => `g_${groupId}`;

const questionCache = new WeakMap<Vocab, Record<string, ChoiceQuestion>>();

/**
 * Build the per-step questions once: one "which kind of word?" question over the groups (+ END),
 * and one "which word?" question per group. Jev answers them all in a single request, which gives
 * P(word) = P(group) × P(word | group) over the whole vocabulary.
 */
export function buildQuestions(v: Vocab): Record<string, ChoiceQuestion> {
  const cached = questionCache.get(v);
  if (cached) return cached;
  const groupCriteria: Record<string, string> = {};
  for (const g of v.groups) groupCriteria[g.id] = g.description;
  groupCriteria[END_LABEL] = "nothing: the reply is already a complete, sensible answer, so stop here";

  const questions: Record<string, ChoiceQuestion> = {
    [GROUP_QUESTION]: choice(
      `${PERSONA} What kind of word should come next in the assistant's reply so it stays fluent, ` +
        "grammatical, and responsive to the user's latest message? Choose END only when the reply is " +
        "a complete answer that already ends with punctuation.",
      groupCriteria,
    ),
  };
  for (const g of v.groups) {
    const criteria: Record<string, string | null> = {};
    for (const w of g.words) criteria[w] = g.descriptions[w] ?? null;
    questions[wordQuestionName(g.id)] = choice(
      `${PERSONA} The next word of the assistant's reply is ${g.description}. Which word should it be ` +
        "so the reply stays fluent, grammatical, and relevant to the user's latest message?",
      criteria,
    );
  }
  questionCache.set(v, questions);
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

export class TypeSafeBackend implements NextWordBackend {
  readonly kind = "typesafe" as const;
  readonly modelHint: string;
  private readonly client: TypeSafeClient;
  private readonly questions: Record<string, ChoiceQuestion>;

  constructor(
    private readonly v: Vocab = defaultVocab,
    // Reads TYPESAFE_API_KEY, TYPESAFE_BASE_URL and TYPESAFE_DEFAULT_MODEL from the environment.
    client: TypeSafeClient = new TypeSafeClient(),
  ) {
    this.client = client;
    this.modelHint = client.defaultModel;
    this.questions = buildQuestions(v);
  }

  async distribution(ctx: NextWordContext, signal?: AbortSignal): Promise<DistributionResult> {
    const res = await this.client.systemOne(
      { state: buildState(ctx), questions: this.questions },
      { signal },
    );
    const answers = res.answers as unknown as Record<string, ChoiceResponse>;
    return { probs: combineAnswers(this.v, answers), model: res.model };
  }
}
