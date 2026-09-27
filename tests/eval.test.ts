import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { MOCK_CORPUS } from "@/lib/backends/corpus";
import { MockBackend } from "@/lib/backends/mock";
import { judgeReply, shuffleWords } from "@/lib/eval/judge";
import { buildControls, type EvalPlan, parseArgs, runEval, summarize } from "@/lib/eval/run";
import { type GenerationEvent, generateReply, resolveSettings } from "@/lib/generate";
import { seededRng } from "@/lib/sampling";
import { vocab } from "@/lib/vocab";

const mock = new MockBackend(vocab, MOCK_CORPUS, [0, 0]);
const hi = [{ role: "user" as const, content: "Hi! Who are you?" }];

async function collect(events: AsyncGenerator<GenerationEvent>) {
  const out: GenerationEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("generateReply", () => {
  it("is deterministic with a seeded rng and starts with a meta event", async () => {
    const run = () => collect(generateReply({ backend: mock, messages: hi, settings: resolveSettings(), rng: seededRng(7) }));
    const a = await run();
    expect(a[0]).toMatchObject({ type: "meta", backend: "mock", model: "mock-trigram" });
    expect(await run()).toEqual(a);
    expect(a.at(-1)).toMatchObject({ type: "done", inputTokens: 0 });
  });

  it("stops at maxWords", async () => {
    const events = await collect(
      generateReply({ backend: mock, messages: hi, settings: resolveSettings({ maxWords: 3 }), rng: seededRng(1) }),
    );
    expect(events.filter((e) => e.type === "token")).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "max_words" });
  });

  it("stops early on END", async () => {
    const reasons = new Set<string>();
    for (let seed = 0; seed < 10; seed++) {
      const events = await collect(generateReply({ backend: mock, messages: hi, settings: resolveSettings(), rng: seededRng(seed) }));
      const done = events.at(-1) as Extract<GenerationEvent, { type: "done" }>;
      reasons.add(done.reason);
    }
    expect(reasons.has("end")).toBe(true);
  });

  it("clamps untrusted settings", () => {
    expect(resolveSettings({ temperature: 99, topK: -5, maxWords: 1e6 })).toMatchObject({ temperature: 2, topK: 0, maxWords: 200 });
  });
});

describe("judge", () => {
  it("grades a reply in one request and parses the scores", async () => {
    let sent: { state: unknown; questions: Record<string, { type: string; criteria?: unknown[] }> } | undefined;
    const fetch = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        model: "jev-test",
        usage: { input_tokens: 123, output_tokens: 0 },
        answers: {
          fluency: { type: "score", score: 3.2, confidence: 0.8, legend: {}, probabilities: {} },
          relevance: { type: "score", score: 1.5, confidence: 0.7, legend: {}, probabilities: {} },
          complete: { type: "noul", noul: 0.9 },
        },
      });
    };
    const client = new TypeSafeClient({ apiKey: "sk-test", fetch, retry: { maxRetries: 0 } });
    expect(await judgeReply(client, "What is your favorite fruit?", "I can can't apple")).toEqual({
      fluency: 3.2,
      relevance: 1.5,
      complete: 0.9,
      inputTokens: 123,
    });
    expect(sent!.state).toEqual({ user_message: "What is your favorite fruit?", assistant_reply: "I can can't apple" });
    expect(sent!.questions.fluency).toMatchObject({ type: "score" });
    expect(sent!.questions.fluency.criteria).toHaveLength(5);
    expect(sent!.questions.complete.type).toBe("noul");
  });

  it("shuffles words reproducibly without losing any", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    expect(shuffleWords(text, 3)).toBe(shuffleWords(text, 3));
    expect(shuffleWords(text, 3)).not.toBe(text);
    expect(shuffleWords(text, 3).split(" ").sort()).toEqual(text.split(" ").sort());
  });
});

describe("eval runner", () => {
  it("parses arguments and rejects bad ones", () => {
    expect(parseArgs([])).toMatchObject({ configs: null, samples: 3, generator: "jev", judge: true, yes: false });
    expect(parseArgs(["--configs", "cold,greedy", "--samples", "2", "--generator", "mock", "--no-judge", "-y"])).toMatchObject({
      configs: ["cold", "greedy"],
      samples: 2,
      generator: "mock",
      judge: false,
      yes: true,
    });
    expect(() => parseArgs(["--samples", "0"])).toThrow(/integer/);
    expect(() => parseArgs(["--generator", "gpt"])).toThrow(/jev or mock/);
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown option/);
  });

  const prompts = [
    { id: "a", prompt: "Hi!", gold: "Hello there, nice to meet you." },
    { id: "b", prompt: "Favorite fruit?", gold: "I think I would pick a banana." },
  ];

  it("builds gold, shuffled, and mismatched controls", () => {
    const controls = buildControls(prompts, 1);
    expect(controls.map((c) => c.kind)).toEqual(["gold", "shuffled", "mismatched", "gold", "shuffled", "mismatched"]);
    expect(controls[2]).toMatchObject({ prompt: "Hi!", reply: prompts[1].gold });
  });

  it("generates, grades, and summarizes every config in plan order", async () => {
    const plan: EvalPlan = {
      configs: { warm: resolveSettings({ maxWords: 5 }), greedy: resolveSettings({ topK: 1, maxWords: 5 }) },
      prompts,
      samples: 2,
      seed: 1,
      concurrency: 3,
    };
    // Fake judge: gold replies are great, shuffled ones broken, mismatched ones off-topic.
    const judge = async (userMessage: string, reply: string) => {
      const isGold = prompts.some((p) => p.gold === reply);
      const ownGold = prompts.find((p) => p.prompt === userMessage)!.gold === reply;
      return { fluency: isGold ? 4 : 1, relevance: ownGold ? 4 : 0.5, complete: isGold ? 1 : 0, inputTokens: 10 };
    };
    const progress: number[] = [];
    const { generated, controls } = await runEval(plan, { backend: mock, judge, onProgress: (d) => progress.push(d) });

    expect(generated).toHaveLength(8);
    expect(generated.map((r) => r.config)).toEqual(["warm", "warm", "warm", "warm", "greedy", "greedy", "greedy", "greedy"]);
    expect(generated.every((r) => r.words <= 5 && r.judge)).toBe(true);
    expect(progress.at(-1)).toBe(8 + controls.length);

    const summary = summarize(generated, controls);
    expect(summary.configs.map((c) => c.config)).toEqual(["warm", "greedy"]);
    expect(summary.configs[0]).toMatchObject({ replies: 4, errors: 0, fluency: 1, judgeTokens: 40 });
    expect(summary.calibration).toMatchObject({ fluencyGap: 3, relevanceGap: 3.5, ok: true });
  });

  it("records failures without stopping the run", async () => {
    const plan: EvalPlan = { configs: { d: resolveSettings({ maxWords: 3 }) }, prompts, samples: 1, seed: 1, concurrency: 2 };
    const judge = async () => {
      throw new Error("rate limited");
    };
    const { generated } = await runEval(plan, { backend: mock, judge });
    expect(generated.every((r) => r.error === "rate limited" && r.reply.length > 0)).toBe(true);
    expect(summarize(generated, []).configs[0]).toMatchObject({ errors: 2, fluency: null });
  });
});
