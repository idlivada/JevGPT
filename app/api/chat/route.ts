import { backendStatus, getUserKey } from "@/lib/api-key";
import { selectBackend, type ChatMessage } from "@/lib/backends";
import { generateReply, type GenerationSettings, resolveSettings } from "@/lib/generate";

interface ChatRequest {
  messages?: unknown;
  settings?: Partial<GenerationSettings>;
}

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
 *   token {word, display, p, alternatives, reranked}
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
  const settings = resolveSettings(body.settings);

  const { backend } = selectBackend(await getUserKey());
  if (!backend) {
    return Response.json({ error: "Enter your TypeSafe API key in Settings to start chatting." }, { status: 401 });
  }
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

      try {
        for await (const ev of generateReply({ backend, messages, settings, signal: abort.signal })) {
          if (ev.type === "meta") send("meta", { backend: ev.backend, model: ev.model });
          else if (ev.type === "token") {
            const { word, display, p, alternatives, reranked } = ev;
            send("token", { word, display, p, alternatives, reranked });
          } else send("done", { reason: ev.reason });
        }
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
