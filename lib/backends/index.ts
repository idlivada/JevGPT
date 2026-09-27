import { TypeSafeClient } from "@typesafe-ai/sdk";
import { MockBackend } from "./mock";
import { TypeSafeBackend } from "./typesafe";
import type { NextWordBackend } from "./types";

/** Where the active API key came from: the user's browser (via the UI), or nowhere. */
export type KeySource = "user" | null;

export interface BackendSelection {
  /** Null when no key has been entered in the UI, so the chat must not run. */
  backend: NextWordBackend | null;
  keySource: KeySource;
  /** Masked key for display, e.g. "api…a1b2". Never the full key. */
  keyHint?: string;
  /** JEV_BACKEND=mock is set, so keys are ignored. */
  forcedMock: boolean;
}

export function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

let mockBackend: MockBackend | undefined;
/** Backends for keys entered in the UI, most recently used last. */
const userBackends = new Map<string, TypeSafeBackend>();
const MAX_USER_BACKENDS = 20;

function userBackend(apiKey: string): TypeSafeBackend {
  let b = userBackends.get(apiKey);
  if (b) userBackends.delete(apiKey);
  else b = new TypeSafeBackend(undefined, new TypeSafeClient({ apiKey }));
  userBackends.set(apiKey, b);
  if (userBackends.size > MAX_USER_BACKENDS) userBackends.delete(userBackends.keys().next().value!);
  return b;
}

/**
 * Pick the backend for a request. JEV_BACKEND=mock forces the mock trigram model; otherwise the chat
 * needs a key entered in the UI, so visitors never spend the server's credits. TYPESAFE_API_KEY is
 * deliberately ignored here (the smoke and eval scripts still use it).
 */
export function selectBackend(userKey?: string): BackendSelection {
  const forcedMock = (process.env.JEV_BACKEND ?? "auto").toLowerCase() === "mock";
  if (forcedMock) {
    mockBackend ??= new MockBackend();
    return { backend: mockBackend, keySource: null, forcedMock };
  }
  if (userKey) {
    return { backend: userBackend(userKey), keySource: "user", keyHint: maskKey(userKey), forcedMock };
  }
  return { backend: null, keySource: null, forcedMock };
}

export type { ChatMessage, NextWordBackend, NextWordContext } from "./types";
