# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

JevGPT is a ChatGPT-style chat app whose "LLM" is TypeSafe's **Jev**. Jev is a System One model: it returns calibrated probabilities over predefined options instead of generating text. The app emulates an autoregressive LM by asking Jev for a next-word distribution over a fixed ~1,800-word vocabulary, sampling a word, and repeating.

## Commands

```bash
npm run dev          # Next.js dev server on :3000
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest (all tests in tests/)
npx vitest run tests/sampling.test.ts          # one file
npx vitest run -t "combines P(group)"          # tests matching a name
npm run smoke -- "Hi! Who are you?"            # one real Jev call; prints top next words
npm run eval -- --help                         # coherence eval (spends Jev credits; see below)
npm run eval -- --generator mock --no-judge    # eval pipeline without a key
```

Config comes from `.env.local` (see `.env.local.example`): `TYPESAFE_API_KEY` (used only by the smoke/eval scripts), `JEV_BACKEND=mock` (forces the mock, so the chat runs without a key), and `TYPESAFE_DEFAULT_MODEL`. The SDK also honors `TYPESAFE_BASE_URL`, which is handy for pointing at a local fake API in end-to-end tests. `npm run smoke`/`eval` load `.env.local` via `tsx --env-file-if-exists`. Variables already set in the shell take precedence.

Imports use the `@/` alias for the repo root (set in both `tsconfig.json` and `vitest.config.mts`). `.claude/launch.json` defines a `jevgpt` preview config that runs `npm run dev`.

## Architecture

### Generation pipeline
`app/api/chat/route.ts` (POST) → `selectBackend()` → `generateReply()` → SSE events → `components/Chat.tsx` (parsed by `lib/sse.ts`).

- **`lib/generate.ts`** holds the single autoregressive loop used by both the chat route and the eval. It yields `meta`, `token` and `done` events. `resolveSettings()` clamps untrusted settings from request bodies and eval configs (for example `maxWords` defaults to 60 with a cap of 200). `rerank` is capped at 50 and defaults to 0 (off); values below 2 also mean off. Only the UI turns re-ranking on, so the eval's `default` config and any direct API call run without it.
- **`lib/backends/index.ts` `selectBackend(userKey)`** picks the backend: `JEV_BACKEND=mock` → `MockBackend`; otherwise a key entered in the UI (cookie); otherwise `backend: null`, and `/api/chat` returns 401 while the UI shows the key form in place of the composer. This is deliberate: the chat never falls back to the server's `TYPESAFE_API_KEY`, so public visitors can't spend the owner's credits. Backends implement `NextWordBackend` (`lib/backends/types.ts`): `distribution()`, plus optional `rerank()`.
- **SSE contract:** `meta {backend, model}` (sent again when the real model version arrives), `token {word, display, p, alternatives, reranked}`, `done {reason}`, `error {message}`. The server sends `display`, meaning the spacing and capitalization from `lib/detokenize.ts`, so the client never re-derives it.

### How a next-word distribution is built (`lib/backends/typesafe.ts`)
Jev's `choice` allows **at most 255 options**, so `data/vocab.json` is split into groups of ≤255 words. Each step is **one** `systemOne` request with:
- `group`: which group comes next (one option per group, plus the `END` label)
- `g_<groupId>`: which word within that group

`combineAnswers()` computes P(word) = P(group) × P(word | group). A word listed in several groups gets the sum. END's probability comes only from the group question.

The static questions are cached per vocab. `quoteReply` rebuilds the instructions each step but shares the cached option lists. Every request sends the whole vocabulary, so tokens (~14k per step on jev-1.13.0) and cost scale with vocab size.

### Re-ranking (on by default in the UI)
With `rerank: N` (the UI uses `DEFAULT_RERANK_CANDIDATES = 12` from `lib/defaults.ts`), the loop:
1. Shortlists the top N words using the normal masks and repetition penalty (`adjustDistribution`).
2. Calls `backend.rerank()`, which sends one extra `choice` question whose option labels are the full continuations ("I think so", "I think.", "… [end of reply]").
3. Samples from Jev's answer.

When a token is re-ranked, its `p`/`alternatives` come from the re-rank distribution, not the next-word distribution. A word the base distribution doesn't rank in the top N can never be chosen.

### Sampling (`lib/sampling.ts`)
`adjustDistribution()` applies hard masks before temperature/top-k/top-p:
- no END or punctuation as the first token
- no punctuation right after punctuation
- never the exact previous word
- a repetition penalty on words already in the reply

If the masks remove everything, it falls back to the raw distribution. `sampleNextWord` reports `p` from the unadjusted distribution.

### Mock backend (`lib/backends/mock.ts`)
An interpolated trigram model trained on `lib/backends/corpus.ts`, with a boost for topic words from the user's message. It only reads the latest user message. Every corpus token must be in the vocabulary (a test enforces this), so add words to `data/vocab.json` when you extend the corpus.

### API key handling
`/api/key` verifies a user-entered key with `client.models.list()`. It stores the key in an httpOnly, SameSite=strict cookie `jevgpt_api_key` scoped to `path: /api`. Status responses only ever include a masked `keyHint` (`lib/api-key.ts` `backendStatus`).

### Client/server boundaries
- Client components must only import client-safe modules: `lib/defaults.ts`, `lib/chat-types.ts`, `lib/sse.ts`, `lib/chat-history.ts`. Importing `lib/vocab.ts` or `lib/sampling.ts` would bundle `vocab.json` into the browser.
- The app can be served under a sub-path (`NEXT_PUBLIC_BASE_PATH`, e.g. `/jevgpt`, which also sets Next's `basePath`). Next prefixes links and assets, but not `fetch()` URLs or cookie paths, so client fetches must use `${BASE_PATH}/api/...` from `lib/defaults.ts`, and the key cookie uses `API_KEY_COOKIE_PATH`.
- Next.js route files may only export route handlers and route config. Shared constants live in `lib/`.
- UI settings persist in `localStorage` (`jevgpt:settings`), merged over `DEFAULT_UI_SETTINGS` in `Chat.tsx`, so new settings pick up their defaults automatically. The "Chat history" toggle decides client-side which messages are sent (`lib/chat-history.ts`). The Jev backend keeps only the last `MAX_HISTORY_MESSAGES` (8).

### Vocabulary (`data/vocab.json`)
Words are space-separated strings per group. Group ids are `[a-z][a-z0-9_]*`. Words must be unique within a group, and `<END>` is reserved. The optional `descriptions` map provides the criteria text sent to Jev (used for punctuation). `parseVocab()` validates everything at startup, and `tests/vocab.test.ts` enforces the limits.

## Coherence eval (`npm run eval`)
- **Code:** `scripts/eval.ts` (CLI) is a thin layer over `lib/eval/run.ts` (orchestration, summaries, cost estimate) and `lib/eval/judge.ts` (a Jev `score`/`noul` grader).
- **Inputs:** prompts live in `eval/prompts.json` (each with a gold reply). Named configs in `eval/configs.json` are partial `GenerationSettings`: add a config there to test a new strategy.
- **Judge check:** before trusting scores, check the judge line. Gold replies must beat word-shuffled (fluency) and mismatched (relevance) controls by ≥1.5.
- **Cost:** runs spend real credits. The script prints an upper-bound cost and asks for confirmation unless `--yes` is passed. `estimateStepTokens()`/`JUDGE_TOKENS_ESTIMATE` are calibrated to measured jev-1.13.0 usage; recalibrate if the vocabulary or questions change.
- **Output:** results go to `eval/results/` (git-ignored).
- **Findings so far** (5 prompts × 2 samples): temperature and top-k barely matter. Re-ranking raised fluency from ~2.6 to ~3.2/4, while quoting the reply did not help. Remaining weaknesses are short, vague replies, and the shortlist missing the right word.

## Testing conventions
- **Deterministic generation:** use `new MockBackend(vocab, MOCK_CORPUS, [0, 0])` (no simulated latency) with `seededRng(n)`.
- **Code that goes through the TypeSafe SDK:** inject `new TypeSafeClient({ apiKey: "sk-test", fetch: fakeFetch, retry: { maxRetries: 0 } })`. `TypeSafeBackend` and `verifyApiKey` both accept a client or fetch for this. The SDK returns the raw JSON body, so fakes must match the real wire shape, e.g. `/v1/models` returns `{ models: [...] }`.
