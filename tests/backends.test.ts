import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { MOCK_CORPUS } from "@/lib/backends/corpus";
import { MockBackend, tokenize } from "@/lib/backends/mock";
import { buildQuestions, buildState, combineAnswers, TypeSafeBackend } from "@/lib/backends/typesafe";
import { END, MAX_CHOICE_OPTIONS, parseVocab, vocab } from "@/lib/vocab";

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const ctx = (user: string, replySoFar: string[] = []) => ({
  messages: [{ role: "user" as const, content: user }],
  replySoFar,
});

describe("MockBackend", () => {
  const mock = new MockBackend(vocab, MOCK_CORPUS, [0, 0]);

  it("learns from a corpus that is fully inside the vocabulary", () => {
    expect(tokenize(MOCK_CORPUS, vocab).unknown).toEqual([]);
  });

  it("returns a normalized distribution over every word plus END", async () => {
    const { probs, model } = await mock.distribution(ctx("hello"));
    expect(model).toBe("mock-trigram");
    expect(probs.size).toBe(vocab.words.length + 1);
    expect(probs.has(END)).toBe(true);
    expect(total(probs)).toBeCloseTo(1, 6);
  });

  it("prefers continuations seen in the corpus", () => {
    const probs = mock.probabilities(ctx("hi", ["I'm", "JevGPT", ","]));
    expect(probs.get("a")!).toBeGreaterThan(probs.get("banana")! * 10);
  });

  it("boosts topic words from the user's message", () => {
    const plain = mock.probabilities(ctx("hello"));
    const topical = mock.probabilities(ctx("tell me about pizza"));
    expect(topical.get("pizza")!).toBeGreaterThan(plain.get("pizza")! * 3);
  });
});

describe("TypeSafe backend", () => {
  const small = parseVocab({
    groups: [
      { id: "nouns", description: "a noun", words: "cat dog" },
      { id: "verbs", description: "a verb", words: "run dog" },
    ],
  });

  it("builds one group question plus one word question per group, all within Jev's limits", () => {
    const qs = buildQuestions(vocab);
    expect(Object.keys(qs)).toHaveLength(vocab.groups.length + 1);
    expect(Object.keys(qs.group.criteria)).toContain("END");
    for (const q of Object.values(qs)) expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
    expect(qs.g_punctuation.criteria["."]).toMatch(/period/);
  });

  it("puts the conversation and reply-so-far in the state", () => {
    const state = buildState(ctx("hi there", ["hello", ","]));
    expect(state).toEqual({
      conversation: [{ role: "user", text: "hi there" }],
      assistant_reply_so_far: "Hello,",
    });
  });

  it("combines P(group) × P(word | group), summing words listed in several groups", () => {
    const probs = combineAnswers(small, {
      group: { probabilities: { nouns: 0.5, verbs: 0.3, END: 0.2 } },
      g_nouns: { probabilities: { cat: 0.6, dog: 0.4 } },
      g_verbs: { probabilities: { run: 0.9, dog: 0.1 } },
    });
    expect(probs.get("cat")).toBeCloseTo(0.3);
    expect(probs.get("run")).toBeCloseTo(0.27);
    expect(probs.get("dog")).toBeCloseTo(0.5 * 0.4 + 0.3 * 0.1);
    expect(probs.get(END)).toBeCloseTo(0.2);
    expect(total(probs)).toBeCloseTo(1);
  });

  it("sends the request through the SDK and parses the response", async () => {
    let sent: Record<string, unknown> | undefined;
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        model: "jev-test",
        usage: { input_tokens: 10, output_tokens: 0 },
        answers: {
          group: { type: "choice", choice: "nouns", confidence: 0.9, probabilities: { nouns: 1, verbs: 0, END: 0 } },
          g_nouns: { type: "choice", choice: "cat", confidence: 0.9, probabilities: { cat: 0.75, dog: 0.25 } },
          g_verbs: { type: "choice", choice: "run", confidence: 0.9, probabilities: { run: 1, dog: 0 } },
        },
      });
    };
    const client = new TypeSafeClient({ apiKey: "sk-test", fetch: fakeFetch, retry: { maxRetries: 0 } });
    const backend = new TypeSafeBackend(small, client);
    const { probs, model } = await backend.distribution(ctx("pets?"));

    expect(model).toBe("jev-test");
    expect(probs.get("cat")).toBeCloseTo(0.75);
    expect(Object.keys(sent!.questions as object)).toEqual(["group", "g_nouns", "g_verbs"]);
    expect(sent!.state).toMatchObject({ assistant_reply_so_far: "" });
  });
});
