import { backendStatus, getUserKey } from "@/lib/api-key";
import { selectBackend, type ChatMessage } from "@/lib/backends";
import { formatToken } from "@/lib/detokenize";
import { DEFAULT_MAX_WORDS, DEFAULT_SETTINGS, sampleNextWord, type SamplingSettings } from "@/lib/sampling";
import { END } from "@/lib/vocab";

const MAX_MAX_WORDS = 200;

interface ChatRequest {
  messages?: unknown;
  settings?: Partial<SamplingSettings & { maxWords: number }>;
}

const clamp = (x: unknown, lo: number, hi: number, fallback: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

function parseMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const m of input.slice(-50)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    out.push({ role: m.role, content: m.content });
  }
  return out.at(-1)?.role === "user" ? out : null;
}

/** Which backend is active, so the UI can show a badge before the first message. */
export async function GET() {
  return Response.json(backendStatus(await getUserKey()));
}

/**
 * Generate a reply one word at a time, streamed as server-sent events:
 *   meta  {backend, model}           – which model is answering
 *   token {word, display, p, alternatives}
 *   done  {reason: "end" | "max_words"}
 *   error {message}
 */
export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const messages = parseMessages(body.messages);
  if (!messages) {
    return Response.json({ error: "messages must be a non-empty list ending with a user message" }, { status: 400 });
  }
  const s = body.settings ?? {};
  const settings: SamplingSettings = {
    temperature: clamp(s.temperature, 0.05, 2, DEFAULT_SETTINGS.temperature),
    topK: Math.round(clamp(s.topK, 0, 500, DEFAULT_SETTINGS.topK)),
    topP: clamp(s.topP, 0.05, 1, DEFAULT_SETTINGS.topP),
    repetitionPenalty: clamp(s.repetitionPenalty, 1, 3, DEFAULT_SETTINGS.repetitionPenalty),
  };
  const maxWords = Math.round(clamp(s.maxWords, 1, MAX_MAX_WORDS, DEFAULT_MAX_WORDS));

  const { backend } = selectBackend(await getUserKey());
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          abort.abort(); // stream already closed by the client
        }
      };

      let model = backend.modelHint;
      send("meta", { backend: backend.kind, model });
      const reply: string[] = [];
      try {
        let reason: "end" | "max_words" = "max_words";
        while (reply.length < maxWords && !abort.signal.aborted) {
          const dist = await backend.distribution({ messages, replySoFar: reply }, abort.signal);
          if (dist.model !== model) {
            model = dist.model;
            send("meta", { backend: backend.kind, model });
          }
          const next = sampleNextWord(dist.probs, reply, settings);
          if (next.word === END) {
            reason = "end";
            break;
          }
          send("token", {
            word: next.word,
            display: formatToken(reply, next.word),
            p: next.p,
            alternatives: next.alternatives,
          });
          reply.push(next.word);
        }
        send("done", { reason });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[jevgpt] generation failed", err);
          send("error", { message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
