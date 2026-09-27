/**
 * Coherence eval: generate replies for a fixed prompt set under named configs, have Jev grade them,
 * and compare. See `npm run eval -- --help`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { MOCK_CORPUS } from "@/lib/backends/corpus";
import { MockBackend } from "@/lib/backends/mock";
import { TypeSafeBackend } from "@/lib/backends/typesafe";
import { judgeReply } from "@/lib/eval/judge";
import {
  estimateCost,
  type EvalPlan,
  type EvalPrompt,
  formatReport,
  parseArgs,
  renderMarkdown,
  runEval,
  summarize,
  USAGE,
  USD_PER_INPUT_TOKEN,
} from "@/lib/eval/run";
import { type GenerationSettings, resolveSettings } from "@/lib/generate";
import { vocab } from "@/lib/vocab";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const allConfigs = await readJson<Record<string, Partial<GenerationSettings>>>("eval/configs.json");
  delete allConfigs.$comment;
  const names = args.configs ?? Object.keys(allConfigs);
  const unknown = names.filter((n) => !(n in allConfigs));
  if (unknown.length) throw new Error(`Unknown config(s): ${unknown.join(", ")}. Available: ${Object.keys(allConfigs).join(", ")}`);
  const configs = Object.fromEntries(
    names.map((n) => [n, resolveSettings({ ...allConfigs[n], ...(args.maxWords ? { maxWords: args.maxWords } : {}) })]),
  );
  const prompts = (await readJson<EvalPrompt[]>("eval/prompts.json")).slice(0, args.prompts ?? undefined);
  const plan: EvalPlan = { configs, prompts, samples: args.samples, seed: args.seed, concurrency: args.concurrency };

  const needsKey = args.generator === "jev" || args.judge;
  if (needsKey && !process.env.TYPESAFE_API_KEY?.trim()) {
    throw new Error("Set TYPESAFE_API_KEY in .env.local (or pass --generator mock --no-judge to run without Jev).");
  }

  const est = estimateCost(plan, args);
  console.log(
    `${est.replies} replies (${names.join(", ")} × ${prompts.length} prompts × ${args.samples} samples), ` +
      `generator: ${args.generator}, judge: ${args.judge ? "Jev" : "off"}`,
  );
  if (needsKey) {
    console.log(
      `Up to ${(est.genRequests + est.judgeRequests).toLocaleString("en-US")} Jev requests, ` +
        `≈${est.tokens.toLocaleString("en-US")} input tokens, at most ≈$${est.cost.toFixed(2)}.`,
    );
    if (!args.yes) {
      if (!process.stdin.isTTY) throw new Error("Pass --yes to run non-interactively.");
      if (!(await confirm("Continue? [y/N] "))) return;
    }
  }

  const backend = args.generator === "jev" ? new TypeSafeBackend() : new MockBackend(vocab, MOCK_CORPUS, [0, 0]);
  const client = args.judge ? new TypeSafeClient({ retry: { maxRetries: 4 } }) : undefined;
  const startedAt = new Date().toISOString();
  const { generated, controls } = await runWithProgress(plan, backend, client);

  const summary = summarize(generated, controls);
  console.log(`\n${formatReport(summary)}`);
  const totalCost = summary.configs.reduce((s, c) => s + c.cost, 0) + summary.calibration.judgeTokens * USD_PER_INPUT_TOKEN;
  if (needsKey) console.log(`Total cost: $${totalCost.toFixed(4)}`);

  const dir = new URL("../eval/results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const base = new URL(`${stamp}`, dir);
  await writeFile(`${base.pathname}.json`, JSON.stringify({ startedAt, args: argv, plan, summary, generated, controls }, null, 2));
  await writeFile(`${base.pathname}.md`, renderMarkdown(summary, generated, { startedAt, generator: args.generator, args: argv.join(" ") }));
  console.log(`\nSaved eval/results/${stamp}.json and .md`);
}

function runWithProgress(plan: EvalPlan, backend: TypeSafeBackend | MockBackend, client?: TypeSafeClient) {
  return runEval(plan, {
    backend,
    judge: client ? (userMessage, reply) => judgeReply(client, userMessage, reply) : undefined,
    onProgress: (done, total) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${total} done`);
      else if (done === total || done % 25 === 0) console.log(`  ${done}/${total} done`);
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
