"use client";

import { useState } from "react";
import type { BackendInfo } from "@/lib/chat-types";
import { BASE_PATH } from "@/lib/defaults";

interface Props {
  info: BackendInfo | null;
  onInfo: (info: BackendInfo) => void;
}

export default function ApiKeySection({ info, onInfo }: Props) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = async (method: "POST" | "DELETE", body?: object) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/key`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const { warning, ...status } = data;
      onInfo(status as BackendInfo);
      setKey("");
      if (warning) setNotice(warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (info?.forcedMock) {
    return (
      <p className="text-xs text-muted">
        The server has <code className="font-mono">JEV_BACKEND=mock</code> set, so Jev is turned off.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {info?.keySource === "user" && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 text-sm">
          <span>
            Using your key <span className="font-mono text-muted">{info.keyHint}</span>
          </span>
          <button
            type="button"
            onClick={() => request("DELETE")}
            disabled={saving}
            className="text-muted hover:text-fg disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      )}
      {info?.keySource !== "user" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) request("POST", { apiKey: key.trim() });
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="apikey_…"
            aria-label="TypeSafe API key"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-sm outline-none focus:border-muted"
          />
          <button
            type="submit"
            disabled={saving || !key.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-40"
          >
            {saving ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-xs text-amber-700 dark:text-amber-300">{notice}</p>}
      <p className="text-xs text-muted">
        Kept in an httpOnly cookie in this browser and sent only to this app&apos;s server. Get a key at{" "}
        <a href="https://console.typesafe.ai/settings/keys" target="_blank" rel="noreferrer" className="underline">
          console.typesafe.ai
        </a>
        .
      </p>
    </div>
  );
}
