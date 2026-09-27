import type { UiMessage } from "@/lib/chat-types";
import TokenSpan from "./TokenSpan";

function perplexity(ps: number[]): number {
  const logs = ps.map((p) => Math.log(Math.max(p, 1e-9)));
  return Math.exp(-logs.reduce((a, b) => a + b, 0) / logs.length);
}

const STATUS_NOTE: Partial<Record<NonNullable<UiMessage["status"]>, string>> = {
  max_words: "hit max words",
  stopped: "stopped",
};

export default function MessageView({ message, heatmap }: { message: UiMessage; heatmap: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-subtle px-5 py-2.5">{message.content}</div>
      </div>
    );
  }

  const tokens = message.tokens ?? [];
  const streaming = message.status === "streaming";
  const note = message.status && STATUS_NOTE[message.status];
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold">
        J
      </div>
      <div className="min-w-0 flex-1 leading-7">
        <p className="whitespace-pre-wrap">
          {tokens.map((t, i) => (
            <TokenSpan key={i} token={t} heatmap={heatmap} />
          ))}
          {streaming && <span className="caret ml-0.5 inline-block h-4 w-2 translate-y-0.5 rounded-sm bg-fg" />}
        </p>
        {message.status === "error" && (
          <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {message.error ?? "Something went wrong."}
          </p>
        )}
        {!streaming && tokens.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            {tokens.length} words · perplexity {perplexity(tokens.map((t) => t.p)).toFixed(1)}
            {message.model && <> · {message.model}</>}
            {note && <> · {note}</>}
          </p>
        )}
      </div>
    </div>
  );
}
