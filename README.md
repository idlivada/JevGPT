# JevGPT

A ChatGPT-style chat app whose "language model" is [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe AI's System One model. Jev doesn't generate text. It returns calibrated probabilities over a fixed set of options. JevGPT treats a ~1,800-word vocabulary as those options and asks Jev "what's the next word?" over and over. It samples a word, appends it, and repeats, so Jev acts like an autoregressive LM.

## How it works

Jev's `choice` questions allow at most 255 options, so `data/vocab.json` splits the vocabulary into 14 groups (verbs, nouns, punctuation, …). Each generation step is **one** `systemOne` request containing:

- `group`: which kind of word comes next (one option per group, plus `END`)
- `g_<group>`: which word within that group (one question per group)

These combine into a normalized distribution over the whole vocabulary: `P(word) = P(group) × P(word | group)`. Temperature, top-k, top-p and a repetition penalty are then applied, and the word is sampled (`lib/sampling.ts`).

The server streams each word to the browser over SSE (`app/api/chat/route.ts`). Hover or tap any word to see Jev's top alternatives. Turn on **Heatmap** to tint words by probability.

## Running it

```bash
npm install
npm run dev
```

With no API key, the app uses a **mock backend**: a small trigram model trained on `lib/backends/corpus.ts`. To use Jev, do either of these:

- **In the app:** click the **Mock backend** badge (or **Settings**) and paste your TypeSafe key. The server checks it with TypeSafe, then stores it in an httpOnly, SameSite=strict cookie scoped to `/api`. Page scripts can't read it back, and the browser sends it only to this app's server, which uses it to call TypeSafe. **Remove** clears it.
- **On the server:** `cp .env.local.example .env.local`, set `TYPESAFE_API_KEY`, and restart. `npm run smoke` makes one real call and prints the top next words.

A key entered in the app takes precedence over the server's key. `JEV_BACKEND=mock` forces the mock and ignores all keys. `TYPESAFE_DEFAULT_MODEL` pins a Jev version.

If you deploy this publicly, serve it over HTTPS so the cookie gets the `Secure` flag.

## Other scripts

- `npm test`: vitest (sampling, detokenizer, vocab limits, backend selection, key verification, backend wiring with a fake `fetch`)
- `npm run typecheck`, `npm run lint`

## Customizing the vocabulary

Edit `data/vocab.json`. Words are space-separated per group. A group can hold at most 255 words, and a word may appear in more than one group (its probabilities are summed). `npm test` checks the limits.
