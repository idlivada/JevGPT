import type { TokenInfo } from "@/lib/chat-types";

const pct = (p: number) => (p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.001 ? `${(p * 100).toFixed(1)}%` : "<0.1%");

/** Green for words Jev was confident about, red for long-shot picks. */
export function heatColor(p: number): string {
  const hue = 120 * Math.min(1, Math.max(0, p)) ** 0.3;
  return `hsla(${hue.toFixed(0)}, 75%, 50%, 0.3)`;
}

const label = (word: string) => (word === "<END>" ? "⏎ end" : word);

export default function TokenSpan({ token, heatmap }: { token: TokenInfo; heatmap: boolean }) {
  const lead = token.display.startsWith(" ") ? " " : "";
  const text = token.display.slice(lead.length);
  return (
    <>
      {lead}
      <span
        tabIndex={0}
        className="group relative word-in rounded-[3px] outline-none hover:bg-subtle focus:bg-subtle cursor-default"
        style={heatmap ? { backgroundColor: heatColor(token.p) } : undefined}
      >
        {text}
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-48 -translate-x-1/2 rounded-lg border border-border bg-popover p-2 text-xs shadow-lg group-hover:block group-focus:block"
        >
          <span className="mb-1 block text-[11px] text-muted">
            {token.reranked ? "Jev's re-ranked picks" : "Jev's top picks"}
          </span>
          {token.alternatives.map((alt) => (
            <span
              key={alt.word}
              className={`flex items-center gap-2 py-0.5 ${alt.word === token.word ? "font-semibold" : ""}`}
            >
              <span className="w-16 truncate font-mono">{label(alt.word)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                <span className="block h-full rounded-full bg-fg/60" style={{ width: `${alt.p * 100}%` }} />
              </span>
              <span className="w-11 text-right tabular-nums text-muted">{pct(alt.p)}</span>
            </span>
          ))}
          {!token.alternatives.some((a) => a.word === token.word) && (
            <span className="mt-1 block border-t border-border pt-1 font-semibold">
              <span className="font-mono">{token.word}</span>{" "}
              <span className="text-muted">sampled at {pct(token.p)}</span>
            </span>
          )}
        </span>
      </span>
    </>
  );
}
