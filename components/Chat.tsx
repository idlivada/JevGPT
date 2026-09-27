"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BackendInfo, MessageStatus, TokenInfo, UiMessage, UiSettings } from "@/lib/chat-types";
import { requestMessages } from "@/lib/chat-history";
import { BASE_PATH, DEFAULT_MAX_WORDS, DEFAULT_RERANK_CANDIDATES, DEFAULT_SETTINGS } from "@/lib/defaults";
import { readSse } from "@/lib/sse";
import ApiKeySection from "./ApiKeySection";
import Composer from "./Composer";
import HistoryToggle from "./HistoryToggle";
import MessageView from "./MessageView";
import SettingsPanel from "./SettingsPanel";

const DEFAULT_UI_SETTINGS: UiSettings = {
  ...DEFAULT_SETTINGS,
  maxWords: DEFAULT_MAX_WORDS,
  heatmap: false,
  useHistory: true,
  rerank: true,
};
const SETTINGS_KEY = "jevgpt:settings";
const REPO_URL = "https://github.com/idlivada/jevgpt";

const SUGGESTIONS = [
  "Hi! Who are you?",
  "How do you pick your words?",
  "How many r’s in the word strawberry?",
  "What is your favorite city and why?",
];

const newId = () => crypto.randomUUID();

function loadSettings(): UiSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return { ...DEFAULT_UI_SETTINGS, ...JSON.parse(saved) };
  } catch {
    // storage unavailable or corrupt; fall back to defaults
  }
  return DEFAULT_UI_SETTINGS;
}

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    // localStorage is only readable after hydration.
    setSettings(loadSettings());
    fetch(`${BASE_PATH}/api/chat`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {})
      .finally(() => setStatusLoaded(true));
  }, []);

  const updateSettings = (s: UiSettings) => {
    setSettings(s);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
  };

  // Follow the stream unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patch = useCallback((id: string, fn: (m: UiMessage) => UiMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const send = async (text: string) => {
    const user: UiMessage = { id: newId(), role: "user", content: text };
    const reply: UiMessage = { id: newId(), role: "assistant", content: "", tokens: [], status: "streaming" };
    const history = requestMessages(messages, text, settings.useHistory);
    setMessages((ms) => [...ms, user, reply]);
    setBusy(true);
    stickToBottom.current = true;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { temperature, topK, topP, repetitionPenalty, maxWords } = settings;
    const sampling = {
      temperature,
      topK,
      topP,
      repetitionPenalty,
      maxWords,
      rerank: settings.rerank ? DEFAULT_RERANK_CANDIDATES : 0,
    };
    let finalStatus: MessageStatus = "done";
    try {
      const res = await fetch(`${BASE_PATH}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, settings: sampling }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      for await (const ev of readSse(res.body)) {
        if (ev.event === "meta") {
          const meta = ev.data as BackendInfo;
          setInfo((prev) => ({ ...prev, ...meta }));
          patch(reply.id, (m) => ({ ...m, model: meta.model }));
        } else if (ev.event === "token") {
          const t = ev.data as TokenInfo;
          patch(reply.id, (m) => ({ ...m, content: m.content + t.display, tokens: [...(m.tokens ?? []), t] }));
        } else if (ev.event === "done") {
          finalStatus = (ev.data as { reason: string }).reason === "max_words" ? "max_words" : "done";
        } else if (ev.event === "error") {
          throw new Error((ev.data as { message: string }).message);
        }
      }
      patch(reply.id, (m) => ({ ...m, status: finalStatus }));
    } catch (err) {
      if (ctrl.signal.aborted) patch(reply.id, (m) => ({ ...m, status: "stopped" }));
      else patch(reply.id, (m) => ({ ...m, status: "error", error: err instanceof Error ? err.message : String(err) }));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    stop();
    setMessages([]);
  };

  const empty = messages.length === 0;
  const needsKey = info?.backend === null;
  // Until the status arrives, show neither the composer nor the key form, so neither flashes.
  const input = !statusLoaded ? null : needsKey ? (
    <div className="rounded-2xl border border-border p-4">
      <h2 className="mb-1 font-semibold">Enter your TypeSafe API key to start chatting</h2>
      <p className="mb-3 text-sm text-muted">JevGPT runs on your own Jev credits. A reply costs about a cent.</p>
      <ApiKeySection info={info} onInfo={setInfo} />
    </div>
  ) : (
    <Composer busy={busy} onSend={send} onStop={stop} />
  );
  const historyToggle = (
    <HistoryToggle
      on={settings.useHistory}
      mock={info?.backend === "mock"}
      onChange={(useHistory) => updateSettings({ ...settings, useHistory })}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="relative flex h-14 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 px-2">
          <span className="text-lg font-semibold">JevGPT</span>
          {info && (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs hover:opacity-80 ${
                info.backend === "typesafe"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }`}
              title={
                info.backend === "mock"
                  ? "JEV_BACKEND=mock is set: using a local trigram model."
                  : info.backend === "typesafe"
                    ? `Using your TypeSafe key ${info.keyHint ?? ""}`
                    : "Add your TypeSafe API key to start chatting."
              }
            >
              {info.backend === "typesafe" ? `Jev · ${info.model}` : info.backend === "mock" ? "Mock backend" : "Add API key"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
            className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg"
          >
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <button
            onClick={() => updateSettings({ ...settings, heatmap: !settings.heatmap })}
            className={`hidden rounded-lg px-3 py-1.5 text-sm hover:bg-subtle sm:block ${settings.heatmap ? "bg-subtle" : ""}`}
            aria-pressed={settings.heatmap}
          >
            Heatmap
          </button>
          <button onClick={() => setShowSettings((v) => !v)} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm hover:bg-subtle sm:px-3">
            Settings
          </button>
          <button
            onClick={newChat}
            disabled={empty}
            className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm hover:bg-subtle disabled:opacity-40 sm:px-3"
          >
            New chat
          </button>
        </div>
        {showSettings && (
          <SettingsPanel
            info={info}
            onInfo={setInfo}
            settings={settings}
            onChange={updateSettings}
            onReset={() => updateSettings(DEFAULT_UI_SETTINGS)}
            onClose={() => setShowSettings(false)}
          />
        )}
      </header>

      {empty ? (
        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
          <h1 className="mb-2 text-center text-3xl font-semibold">What can I help with?</h1>
          <p className="mb-8 max-w-md text-center text-sm text-muted">
            Every word is picked by Jev from a {info?.vocabSize?.toLocaleString() ?? "fixed"}-word vocabulary, one
            probability distribution at a time.
          </p>
          <div className="w-full max-w-3xl">
            {input}
            {statusLoaded && !needsKey && (
              <>
                {historyToggle}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-border px-4 py-2 text-sm text-muted hover:bg-subtle hover:text-fg"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="flex-1 overflow-y-auto overflow-x-hidden"
          >
            <div className="mx-auto max-w-3xl space-y-8 px-4 pb-8 pt-16">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} heatmap={settings.heatmap} />
              ))}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-3">
            {input}
            {!needsKey && historyToggle}
            <p className="mt-1 text-center text-xs text-muted">
              Hover any word to see what else Jev considered. JevGPT only knows the words in its vocabulary.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
