import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { MOCK_CORPUS } from "@/lib/backends/corpus";
import { MockBackend } from "@/lib/backends/mock";
import type { NextWordBackend, NextWordContext } from "@/lib/backends/types";
import { buildQuestions, buildRerankQuestion, positionText, TypeSafeBackend } from "@/lib/backends/typesafe";
import { estimateCost } from "@/lib/eval/run";
import { type GenerationEvent, generateReply, resolveSettings } from "@/lib/generate";
import { seededRng } from "@/lib/sampling";
import { END, parseVocab, vocab } from "@/lib/vocab";

const small = parseVocab({
  groups: [
    { id: "nouns", description: "a noun", words: "cat dog" },
    { id: "verbs", description: "a verb", words: "run dog" },
  ],
});
const ctx = (replySoFar: string[], quoteReply = false): NextWordContext => ({
  messages: [{ role: "user", content: "pets?" }],
  replySoFar,
  quoteReply,
});

type Sent = { state: unknown; questions: Record<string, { instructions: string; criteria: Record<string, unknown> }> };

function fakeClient(answers: (sent: Sent) => Record<string, unknown>) {
  const requests: Sent[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as Sent;
    requests.push(sent);
    return Response.json({ model: "jev-test", usage: { input_tokens: 50, output_tokens: 0 }, answers: answers(sent) });
  };
  return { client: new TypeSafeClient({ apiKey: "sk-test", fetch, retry: { maxRetries: 0 } }), requests };
}

describe("quote the reply so far", () => {
  it("describes the exact slot being filled", () => {
    expect(positionText([])).toMatch(/hasn't started/);
    const text = positionText(["well", ",", "I", "think", "that", "cats"]);
    expect(text).toContain('so far is exactly: "Well, I think that cats"');
    expect(text).toContain('right after "I think that cats"');
  });

  it("adds the position to every question without touching the cached static questions", () => {
    const quoted = buildQuestions(vocab, "POSITION MARKER.");
    expect(Object.values(quoted).every((q) => String(q.instructions).includes("POSITION MARKER."))).toBe(true);
    const plain = buildQuestions(vocab);
    expect(Object.values(plain).some((q) => String(q.instructions).includes("POSITION MARKER."))).toBe(false);
    expect(quoted.g_verbs.criteria).toBe(plain.g_verbs.criteria); // option lists are shared, not rebuilt
  });

  it("sends the quoted questions when the context asks for it", async () => {
    const { client, requests } = fakeClient(() => ({
      group: { type: "choice", choice: "nouns", confidence: 1, probabilities: { nouns: 1, verbs: 0, END: 0 } },
      g_nouns: { type: "choice", choice: "cat", confidence: 1, probabilities: { cat: 1, dog: 0 } },
      g_verbs: { type: "choice", choice: "run", confidence: 1, probabilities: { run: 1, dog: 0 } },
    }));
    const backend = new TypeSafeBackend(small, client);
    await backend.distribution(ctx(["my", "pet", "is", "a"], true));
    await backend.distribution(ctx(["my", "pet", "is", "a"], false));
    expect(requests[0].questions.group.instructions).toContain('"My pet is a"');
    expect(requests[1].questions.group.instructions).not.toContain('"My pet is a"');
  });
});

describe("re-ranking", () => {
  it("offers whole continuations, including ending the reply", () => {
    const { question, labelToWord } = buildRerankQuestion(["I", "think"], ["so", ".", END]);
    expect(Object.keys(question.criteria)).toEqual(["I think so", "I think.", "I think [end of reply]"]);
    expect(labelToWord.get("I think.")).toBe(".");
    expect(Object.keys(buildRerankQuestion([], ["hello"]).question.criteria)).toEqual(["Hello"]);
  });

  it("maps Jev's choice back to candidate words", async () => {
    const { client, requests } = fakeClient((sent) => {
      const labels = Object.keys(sent.questions.continuation.criteria);
      return {
        continuation: {
          type: "choice",
          choice: labels[1],
          confidence: 0.6,
          probabilities: Object.fromEntries(labels.map((l, i) => [l, [0.1, 0.6, 0.3][i]])),
        },
      };
    });
    const { probs, inputTokens } = await new TypeSafeBackend(small, client).rerank(ctx(["I"]), ["is", "can", END]);
    expect(Object.keys(requests[0].questions)).toEqual(["continuation"]);
    expect(probs.get("can")).toBeCloseTo(0.6);
    expect(probs.get(END)).toBeCloseTo(0.3);
    expect(inputTokens).toBe(50);
  });

  it("asks the backend to judge a shortlist of at most k candidates each step", async () => {
    const mock = new MockBackend(vocab, MOCK_CORPUS, [0, 0]);
    const shortlists: string[][] = [];
    const spy: NextWordBackend = {
      kind: "mock",
      modelHint: mock.modelHint,
      distribution: (c, s) => mock.distribution(c, s),
      rerank: (c, candidates) => {
        shortlists.push(candidates);
        return mock.rerank(c, candidates);
      },
    };
    const run = async () => {
      const events: GenerationEvent[] = [];
      const settings = resolveSettings({ rerank: 5, maxWords: 8 });
      for await (const e of generateReply({ backend: spy, messages: ctx([]).messages, settings, rng: seededRng(3) })) {
        events.push(e);
      }
      return events;
    };
    const events = await run();
    const tokens = events.filter((e) => e.type === "token");
    expect(shortlists.length).toBeGreaterThanOrEqual(tokens.length);
    expect(shortlists.every((c) => c.length >= 2 && c.length <= 5)).toBe(true);
    expect(tokens.every((t) => shortlists.some((c) => c.includes(t.word)))).toBe(true);
    expect(await run()).toEqual(events); // still deterministic with a seed
  });
});

describe("strategy settings", () => {
  it("validates quoteReply and rerank", () => {
    expect(resolveSettings({})).toMatchObject({ quoteReply: false, rerank: 0 });
    expect(resolveSettings({ rerank: 1 }).rerank).toBe(0);
    expect(resolveSettings({ rerank: 500 }).rerank).toBe(50);
    expect(resolveSettings({ quoteReply: "yes" as unknown as boolean }).quoteReply).toBe(false);
  });

  it("counts the extra requests and tokens in the cost estimate", () => {
    const plan = (s: object) => ({
      configs: { x: resolveSettings({ maxWords: 10, ...s }) },
      prompts: [{ id: "a", prompt: "hi", gold: "hello" }],
      samples: 1,
      seed: 1,
      concurrency: 1,
    });
    const opts = { judge: false, generator: "jev" as const };
    const base = estimateCost(plan({}), opts);
    const rerank = estimateCost(plan({ rerank: 12 }), opts);
    const quote = estimateCost(plan({ quoteReply: true }), opts);
    expect(rerank.genRequests).toBe(base.genRequests * 2);
    expect(rerank.tokens).toBeGreaterThan(base.tokens);
    expect(quote.genRequests).toBe(base.genRequests);
    expect(quote.tokens).toBeGreaterThan(base.tokens);
  });
});
