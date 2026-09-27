import type { NextWordBackend } from "../backends/types";
import { buildQuestions } from "../backends/typesafe";
import { detokenize } from "../detokenize";
import { generateReply, type GenerationSettings } from "../generate";
import { seededRng } from "../sampling";
import { vocab } from "../vocab";
import { type JudgeResult, MAX_SCORE, shuffleWords } from "./judge";

/** Jev input price, USD per token ($0.042 per million). Output is free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1e6;
/** A judge that can't separate gold replies from controls by this many levels isn't trustworthy. */
export const MIN_CALIBRATION_GAP = 1.5;

export interface EvalPrompt {
  id: string;
  prompt: string;
  gold: string;
}

export interface EvalArgs {
  /** Config names to run; null means all of them. */
  configs: string[] | null;
  samples: number;
  /** Use only the first N prompts; null means all. */
  prompts: number | null;
  concurrency: number;
  generator: "jev" | "mock";
  judge: boolean;
  seed: number;
  maxWords: number | null;
  yes: boolean;
  help: boolean;
}

export const USAGE = `Usage: npm run eval -- [options]

  --configs a,b       Configs from eval/configs.json to run (default: all)
  --samples N         Replies per prompt per config (default: 3)
  --prompts N         Use only the first N prompts (default: all)
  --max-words N       Override max words per reply for every config
  --concurrency N     Replies generated in parallel (default: 8)
  --generator jev|mock  Generate with Jev (default) or the local mock
  --no-judge          Skip Jev grading (no API key needed with --generator mock)
  --seed N            Sampling seed (default: 1)
  --yes               Don't ask for confirmation before spending tokens
`;

export function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    configs: null,
    samples: 3,
    prompts: null,
    concurrency: 8,
    generator: "jev",
    judge: true,
    seed: 1,
    maxWords: null,
    yes: false,
    help: false,
  };
  const int = (flag: string, v: string | undefined, min: number) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} needs an integer ≥ ${min}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case "--configs":
        args.configs = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (args.configs.length === 0) throw new Error("--configs needs at least one name");
        break;
      case "--samples":
        args.samples = int(flag, next(), 1);
        break;
      case "--prompts":
        args.prompts = int(flag, next(), 1);
        break;
      case "--max-words":
        args.maxWords = int(flag, next(), 1);
        break;
      case "--concurrency":
        args.concurrency = int(flag, next(), 1);
        break;
      case "--seed":
        args.seed = int(flag, next(), 0);
        break;
      case "--generator": {
        const g = next();
        if (g !== "jev" && g !== "mock") throw new Error("--generator must be jev or mock");
        args.generator = g;
        break;
      }
      case "--no-judge":
        args.judge = false;
        break;
      case "--yes":
      case "-y":
        args.yes = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return args;
}

export interface GeneratedRecord {
  config: string;
  promptId: string;
  prompt: string;
  sample: number;
  reply: string;
  words: number;
  reason: "end" | "max_words" | "error";
  perplexity: number | null;
  model: string;
  genTokens: number;
  judge?: JudgeResult;
  error?: string;
}

export type ControlKind = "gold" | "shuffled" | "mismatched";

export interface ControlRecord {
  kind: ControlKind;
  promptId: string;
  prompt: string;
  reply: string;
  judge?: JudgeResult;
  error?: string;
}

export interface EvalPlan {
  configs: Record<string, GenerationSettings>;
  prompts: EvalPrompt[];
  samples: number;
  seed: number;
  concurrency: number;
}

export interface EvalDeps {
  backend: NextWordBackend;
  /** Omit to skip grading. */
  judge?: (userMessage: string, reply: string) => Promise<JudgeResult>;
  onProgress?: (done: number, total: number) => void;
}

/** Stable 32-bit hash, so each (config, prompt, sample) gets its own reproducible RNG. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function perplexity(ps: number[]): number | null {
  if (ps.length === 0) return null;
  const meanLog = ps.reduce((s, p) => s + Math.log(Math.max(p, 1e-9)), 0) / ps.length;
  return Math.exp(-meanLog);
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Controls that check the judge itself: gold replies should beat shuffled and mismatched ones. */
export function buildControls(prompts: EvalPrompt[], seed: number): ControlRecord[] {
  return prompts.flatMap((p, i) => [
    { kind: "gold" as const, promptId: p.id, prompt: p.prompt, reply: p.gold },
    { kind: "shuffled" as const, promptId: p.id, prompt: p.prompt, reply: shuffleWords(p.gold, seed + i) },
    {
      kind: "mismatched" as const,
      promptId: p.id,
      prompt: p.prompt,
      reply: prompts[(i + 1) % prompts.length].gold,
    },
  ]);
}

export async function runEval(plan: EvalPlan, deps: EvalDeps) {
  const jobs = Object.keys(plan.configs).flatMap((config) =>
    plan.prompts.flatMap((p) => Array.from({ length: plan.samples }, (_, sample) => ({ config, p, sample }))),
  );
  const controls = deps.judge && plan.prompts.length > 1 ? buildControls(plan.prompts, plan.seed) : [];
  const total = jobs.length + controls.length;
  let done = 0;
  const tick = () => deps.onProgress?.(++done, total);

  const generated: GeneratedRecord[] = [];
  await pool(jobs, plan.concurrency, async ({ config, p, sample }) => {
    const rng = seededRng(hashSeed(`${plan.seed}:${config}:${p.id}:${sample}`));
    const record: GeneratedRecord = {
      config,
      promptId: p.id,
      prompt: p.prompt,
      sample,
      reply: "",
      words: 0,
      reason: "error",
      perplexity: null,
      model: deps.backend.modelHint,
      genTokens: 0,
    };
    const words: string[] = [];
    const ps: number[] = [];
    try {
      const events = generateReply({
        backend: deps.backend,
        messages: [{ role: "user", content: p.prompt }],
        settings: plan.configs[config],
        rng,
      });
      for await (const ev of events) {
        if (ev.type === "meta") record.model = ev.model;
        else if (ev.type === "token") {
          words.push(ev.word);
          ps.push(ev.p);
        } else {
          record.reason = ev.reason;
          record.genTokens = ev.inputTokens;
        }
      }
      record.reply = detokenize(words);
      record.words = words.length;
      record.perplexity = perplexity(ps);
      if (deps.judge) record.judge = await deps.judge(p.prompt, record.reply);
    } catch (err) {
      record.reply ||= detokenize(words);
      record.words ||= words.length;
      record.error = errorMessage(err);
    }
    generated.push(record);
    tick();
  });

  await pool(controls, plan.concurrency, async (c) => {
    try {
      c.judge = await deps.judge!(c.prompt, c.reply);
    } catch (err) {
      c.error = errorMessage(err);
    }
    tick();
  });

  // Workers finish out of order; restore plan order (config, then prompt, then sample).
  const index = new Map(jobs.map((j, i) => [`${j.config}\u0000${j.p.id}\u0000${j.sample}`, i]));
  const key = (r: GeneratedRecord) => index.get(`${r.config}\u0000${r.promptId}\u0000${r.sample}`)!;
  generated.sort((a, b) => key(a) - key(b));
  return { generated, controls };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface ConfigSummary {
  config: string;
  replies: number;
  errors: number;
  fluency: number | null;
  relevance: number | null;
  /** Share of judged replies Jev thinks end as a complete sentence. */
  complete: number | null;
  words: number | null;
  /** Share of replies that stopped on END rather than hitting max words. */
  ended: number | null;
  perplexity: number | null;
  genTokens: number;
  judgeTokens: number;
  cost: number;
}

export interface Calibration {
  gold: { fluency: number | null; relevance: number | null };
  shuffled: { fluency: number | null };
  mismatched: { relevance: number | null };
  fluencyGap: number | null;
  relevanceGap: number | null;
  ok: boolean | null;
  judgeTokens: number;
}

export function summarize(generated: GeneratedRecord[], controls: ControlRecord[]) {
  const configs = [...new Set(generated.map((r) => r.config))].map((config): ConfigSummary => {
    const rs = generated.filter((r) => r.config === config);
    const ok = rs.filter((r) => !r.error);
    const judged = ok.filter((r) => r.judge);
    const genTokens = rs.reduce((s, r) => s + r.genTokens, 0);
    const judgeTokens = rs.reduce((s, r) => s + (r.judge?.inputTokens ?? 0), 0);
    return {
      config,
      replies: rs.length,
      errors: rs.length - ok.length,
      fluency: mean(judged.map((r) => r.judge!.fluency)),
      relevance: mean(judged.map((r) => r.judge!.relevance)),
      complete: mean(judged.map((r) => (r.judge!.complete >= 0.5 ? 1 : 0))),
      words: mean(ok.map((r) => r.words)),
      ended: mean(ok.map((r) => (r.reason === "end" ? 1 : 0))),
      perplexity: mean(ok.flatMap((r) => (r.perplexity === null ? [] : [r.perplexity]))),
      genTokens,
      judgeTokens,
      cost: (genTokens + judgeTokens) * USD_PER_INPUT_TOKEN,
    };
  });

  const judgedOf = (kind: ControlKind) => controls.filter((c) => c.kind === kind && c.judge).map((c) => c.judge!);
  const gold = judgedOf("gold");
  const goldFluency = mean(gold.map((j) => j.fluency));
  const goldRelevance = mean(gold.map((j) => j.relevance));
  const shuffledFluency = mean(judgedOf("shuffled").map((j) => j.fluency));
  const mismatchedRelevance = mean(judgedOf("mismatched").map((j) => j.relevance));
  const gap = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  const fluencyGap = gap(goldFluency, shuffledFluency);
  const relevanceGap = gap(goldRelevance, mismatchedRelevance);
  const calibration: Calibration = {
    gold: { fluency: goldFluency, relevance: goldRelevance },
    shuffled: { fluency: shuffledFluency },
    mismatched: { relevance: mismatchedRelevance },
    fluencyGap,
    relevanceGap,
    ok:
      fluencyGap === null || relevanceGap === null
        ? null
        : fluencyGap >= MIN_CALIBRATION_GAP && relevanceGap >= MIN_CALIBRATION_GAP,
    judgeTokens: controls.reduce((s, c) => s + (c.judge?.inputTokens ?? 0), 0),
  };
  return { configs, calibration };
}

export type Summary = ReturnType<typeof summarize>;

/**
 * Input tokens per generation step: the full vocabulary question set plus a short state.
 * Jev bills ~1 token per 2.3 characters of this JSON (measured on jev-1.13.0: ~14.3k tokens/step).
 */
export function estimateStepTokens(): number {
  return Math.ceil(JSON.stringify(buildQuestions(vocab)).length / 2.3) + 300;
}

/** Input tokens per judge request (measured on jev-1.13.0: ~530), rounded up. */
export const JUDGE_TOKENS_ESTIMATE = 650;

/** Upper bound on requests and cost, assuming every reply runs to max words. */
export function estimateCost(plan: EvalPlan, opts: { judge: boolean; generator: "jev" | "mock" }) {
  const replies = Object.keys(plan.configs).length * plan.prompts.length * plan.samples;
  const maxSteps = Object.values(plan.configs).reduce((s, c) => s + c.maxWords + 1, 0) * plan.prompts.length * plan.samples;
  const genRequests = opts.generator === "jev" ? maxSteps : 0;
  const judgeRequests = opts.judge ? replies + (plan.prompts.length > 1 ? plan.prompts.length * 3 : 0) : 0;
  const tokens = genRequests * estimateStepTokens() + judgeRequests * JUDGE_TOKENS_ESTIMATE;
  return { replies, genRequests, judgeRequests, tokens, cost: tokens * USD_PER_INPUT_TOKEN };
}

const fmt = (x: number | null, digits = 2) => (x === null ? "–" : x.toFixed(digits));
const pctFmt = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const usd = (x: number) => `$${x.toFixed(x < 1 ? 4 : 2)}`;

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ")).join("\n");
}

const HEADER = ["config", "replies", "errors", `fluency/${MAX_SCORE}`, `relevance/${MAX_SCORE}`, "complete", "words", "ended", "ppl", "tokens", "cost"];

function configRow(c: ConfigSummary): string[] {
  return [
    c.config,
    String(c.replies),
    String(c.errors),
    fmt(c.fluency),
    fmt(c.relevance),
    pctFmt(c.complete),
    fmt(c.words, 1),
    pctFmt(c.ended),
    fmt(c.perplexity, 1),
    (c.genTokens + c.judgeTokens).toLocaleString("en-US"),
    usd(c.cost),
  ];
}

export function calibrationLines(cal: Calibration): string[] {
  if (cal.ok === null) return ["Judge check: skipped (no grading, or fewer than 2 prompts)."];
  return [
    `Judge check: gold fluency ${fmt(cal.gold.fluency)} vs shuffled ${fmt(cal.shuffled.fluency)} ` +
      `(gap ${fmt(cal.fluencyGap)}); gold relevance ${fmt(cal.gold.relevance)} vs mismatched ` +
      `${fmt(cal.mismatched.relevance)} (gap ${fmt(cal.relevanceGap)}).`,
    cal.ok
      ? "Judge looks trustworthy: it clearly separates good replies from the controls."
      : `WARNING: a gap is below ${MIN_CALIBRATION_GAP}. Jev can't reliably tell good replies from the controls, so treat these scores with caution.`,
  ];
}

export function formatReport(summary: Summary): string {
  return [table([HEADER, ...summary.configs.map(configRow)]), "", ...calibrationLines(summary.calibration)].join("\n");
}

export function renderMarkdown(
  summary: Summary,
  generated: GeneratedRecord[],
  meta: { startedAt: string; generator: string; args: string },
): string {
  const md = (s: string) => s.replace(/\|/g, "\\|");
  const tableMd = (rows: string[][]) =>
    [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => `| ${r.map(md).join(" | ")} |`).join("\n");
  const models = [...new Set(generated.map((r) => r.model))].join(", ");
  const out = [
    `# JevGPT eval · ${meta.startedAt}`,
    "",
    `Generator: ${meta.generator} (${models}) · args: \`${meta.args || "(defaults)"}\``,
    "",
    tableMd([HEADER, ...summary.configs.map(configRow)]),
    "",
    ...calibrationLines(summary.calibration),
  ];
  const score = (r: GeneratedRecord) => (r.judge ? r.judge.fluency + r.judge.relevance : -1);
  const line = (r: GeneratedRecord) =>
    `- **${md(r.prompt)}** → ${md(r.reply) || "_(empty)_"}` +
    (r.judge ? ` _(fluency ${fmt(r.judge.fluency)}, relevance ${fmt(r.judge.relevance)})_` : "") +
    (r.error ? ` _(error: ${md(r.error)})_` : "");
  for (const c of summary.configs) {
    const rs = generated.filter((r) => r.config === c.config);
    const ranked = [...rs].sort((a, b) => score(b) - score(a));
    out.push("", `## ${c.config}`, "");
    if (rs.some((r) => r.judge)) {
      out.push("Best:", ...ranked.slice(0, 3).map(line), "", "Worst:", ...ranked.slice(-3).reverse().map(line));
    } else {
      out.push(...rs.slice(0, 6).map(line));
    }
  }
  return out.join("\n") + "\n";
}
