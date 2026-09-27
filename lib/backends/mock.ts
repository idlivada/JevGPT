import { normalize } from "../sampling";
import { END, type Vocab, vocab as defaultVocab } from "../vocab";
import { MOCK_CORPUS } from "./corpus";
import type { DistributionResult, NextWordBackend, NextWordContext, RerankResult } from "./types";

const START = "<s>";
/** Interpolation weights for trigram, bigram, unigram, and uniform estimates. */
const LAMBDAS = [0.6, 0.25, 0.1, 0.05] as const;
/** Multiplier for content words the user just used, so replies echo the topic. */
const TOPIC_BOOST = 4;
const TOKEN_RE = /\.\.\.|[.,!?:;]|'s\b|[A-Za-z0-9]+(?:'[A-Za-z]+)?|-/g;

/** Map a raw token onto the vocabulary, trying exact case then lowercase. */
export function toVocabWord(token: string, v: Vocab): string | undefined {
  if (v.wordSet.has(token)) return token;
  const lower = token.toLowerCase();
  if (v.wordSet.has(lower)) return lower;
  return undefined;
}

export function tokenize(text: string, v: Vocab): { words: string[]; unknown: string[] } {
  const words: string[] = [];
  const unknown: string[] = [];
  for (const t of text.match(TOKEN_RE) ?? []) {
    const w = toVocabWord(t, v);
    if (w) words.push(w);
    else unknown.push(t);
  }
  return { words, unknown };
}

type Counts = Map<string, Map<string, number>>;

function bump(m: Counts, ctx: string, w: string) {
  let inner = m.get(ctx);
  if (!inner) m.set(ctx, (inner = new Map()));
  inner.set(w, (inner.get(w) ?? 0) + 1);
}

function sum(m: Map<string, number> | undefined): number {
  let s = 0;
  for (const c of m?.values() ?? []) s += c;
  return s;
}

/**
 * Stand-in for Jev while there is no API key: an interpolated trigram model trained on a small
 * corpus of chat replies, with a boost for words from the user's latest message.
 */
export class MockBackend implements NextWordBackend {
  readonly kind = "mock" as const;
  readonly modelHint = "mock-trigram";
  private readonly unigrams = new Map<string, number>();
  private readonly bigrams: Counts = new Map();
  private readonly trigrams: Counts = new Map();
  private readonly outcomes: string[];

  constructor(
    private readonly v: Vocab = defaultVocab,
    corpus: string = MOCK_CORPUS,
    private readonly latencyMs: [number, number] = [60, 160],
  ) {
    this.outcomes = [...v.words, END];
    for (const line of corpus.split("\n")) {
      const { words } = tokenize(line, v);
      if (words.length === 0) continue;
      const seq = [START, START, ...words, END];
      for (let i = 2; i < seq.length; i++) {
        const w = seq[i];
        this.unigrams.set(w, (this.unigrams.get(w) ?? 0) + 1);
        bump(this.bigrams, seq[i - 1], w);
        bump(this.trigrams, `${seq[i - 2]} ${seq[i - 1]}`, w);
      }
    }
  }

  /** The model's distribution, without simulated latency. */
  probabilities(ctx: NextWordContext): Map<string, number> {
    const hist = [START, START, ...ctx.replySoFar];
    const b = hist.at(-1)!;
    const a = hist.at(-2)!;
    const tri = this.trigrams.get(`${a} ${b}`);
    const bi = this.bigrams.get(b);
    const triTotal = sum(tri);
    const biTotal = sum(bi);
    const uniTotal = sum(this.unigrams);

    // Redistribute weight from unseen contexts so the estimate stays a proper mixture.
    const weights = [triTotal ? LAMBDAS[0] : 0, biTotal ? LAMBDAS[1] : 0, LAMBDAS[2], LAMBDAS[3]];
    const wTotal = weights.reduce((s, x) => s + x, 0);

    const lastUser = [...ctx.messages].reverse().find((m) => m.role === "user");
    const topic = new Set(
      tokenize(lastUser?.content ?? "", this.v).words.filter((w) => w.length > 3),
    );

    const entries: [string, number][] = this.outcomes.map((w) => {
      let p =
        (weights[0] * ((tri?.get(w) ?? 0) / (triTotal || 1)) +
          weights[1] * ((bi?.get(w) ?? 0) / (biTotal || 1)) +
          weights[2] * ((this.unigrams.get(w) ?? 0) / uniTotal) +
          weights[3] / this.outcomes.length) /
        wTotal;
      if (topic.has(w)) p *= TOPIC_BOOST;
      return [w, p];
    });
    return new Map(normalize(entries));
  }

  async distribution(ctx: NextWordContext, signal?: AbortSignal): Promise<DistributionResult> {
    const [lo, hi] = this.latencyMs;
    if (hi > 0) await sleep(lo + Math.random() * (hi - lo), signal);
    return { probs: this.probabilities(ctx), model: this.modelHint };
  }

  /** The mock has no separate judge: it just renormalizes its own distribution over the candidates. */
  async rerank(ctx: NextWordContext, candidates: string[]): Promise<RerankResult> {
    const probs = this.probabilities(ctx);
    return { probs: new Map(normalize(candidates.map((w) => [w, probs.get(w) ?? 0]))) };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
