"use client";

import { MAX_HISTORY_MESSAGES } from "@/lib/defaults";

interface Props {
  on: boolean;
  /** The mock backend only reads the latest message, so the toggle has no effect there. */
  mock: boolean;
  onChange: (on: boolean) => void;
}

export default function HistoryToggle({ on, mock, onChange }: Props) {
  const detail = mock
    ? "the mock backend only reads your latest message"
    : on
      ? `Jev sees up to the last ${MAX_HISTORY_MESSAGES} messages`
      : "Jev sees only your latest message";
  return (
    <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Include chat history"
        onClick={() => onChange(!on)}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-fg" : "bg-border"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-bg transition-transform ${on ? "translate-x-3" : ""}`}
        />
      </button>
      <span>
        <button type="button" onClick={() => onChange(!on)} className="text-fg">
          Chat history {on ? "on" : "off"}
        </button>
        <span> · {detail}</span>
      </span>
    </div>
  );
}
