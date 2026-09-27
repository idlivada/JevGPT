"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to ~8 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <form
      className="flex items-end gap-2 rounded-[28px] border border-border bg-bg p-2 pl-5 shadow-sm focus-within:border-muted"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask JevGPT anything"
        aria-label="Message"
        className="max-h-[200px] flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg"
        >
          <span className="size-3 rounded-[2px] bg-accent-fg" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-30"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </form>
  );
}
