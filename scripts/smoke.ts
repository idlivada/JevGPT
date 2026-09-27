/**
 * One real Jev call: prints the top next words for a sample prompt and sanity-checks the result.
 *
 *   npm run smoke -- "What's your favorite food?"   (reads TYPESAFE_API_KEY from .env.local)
 */
import { TypeSafeBackend } from "@/lib/backends/typesafe";
import { topAlternatives } from "@/lib/sampling";

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("Set TYPESAFE_API_KEY first (in .env.local, then run: npm run smoke)");
    process.exit(1);
  }
  const prompt = process.argv[2] ?? "Hi! Who are you?";
  const backend = new TypeSafeBackend();
  const started = performance.now();
  const { probs, model } = await backend.distribution({
    messages: [{ role: "user", content: prompt }],
    replySoFar: [],
  });
  const ms = performance.now() - started;

  const total = [...probs.values()].reduce((a, b) => a + b, 0);
  console.log(`model: ${model}   latency: ${ms.toFixed(0)} ms   words scored: ${probs.size}   sum(p): ${total.toFixed(4)}`);
  console.log(`\nTop next words for: "${prompt}"`);
  for (const { word, p } of topAlternatives(probs, 20)) {
    console.log(`  ${word.padEnd(14)} ${(p * 100).toFixed(2).padStart(6)}%  ${"█".repeat(Math.round(p * 60))}`);
  }
  if (Math.abs(total - 1) > 1e-3) {
    console.error("\nProbabilities do not sum to 1!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
