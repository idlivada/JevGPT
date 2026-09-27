import { TypeSafeClient } from "@typesafe-ai/sdk";
import { MockBackend } from "./mock";
import { TypeSafeBackend } from "./typesafe";
import type { NextWordBackend } from "./types";

/** Where the active API key came from: the user's browser (via the UI), the server env, or nowhere. */
export type KeySource = "user" | "env" | null;

export interface BackendSelection {
  backend: NextWordBackend;
  keySource: KeySource;
  /** Masked key for display, e.g. "sk-…a1b2". Never the full key. */
  keyHint?: string;
  /** JEV_BACKEND=mock is set, so keys are ignored. */
  forcedMock: boolean;
}

export function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

let mockBackend: MockBackend | undefined;
let envBackend: TypeSafeBackend | undefined;
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
 * Pick the backend for a request. Precedence: JEV_BACKEND=mock forces the mock; otherwise a key
 * entered in the UI, then TYPESAFE_API_KEY from the server env, then the mock trigram model.
 */
export function selectBackend(userKey?: string): BackendSelection {
  const forcedMock = (process.env.JEV_BACKEND ?? "auto").toLowerCase() === "mock";
  const envKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!forcedMock && userKey) {
    return { backend: userBackend(userKey), keySource: "user", keyHint: maskKey(userKey), forcedMock };
  }
  if (!forcedMock && envKey) {
    envBackend ??= new TypeSafeBackend();
    return { backend: envBackend, keySource: "env", keyHint: maskKey(envKey), forcedMock };
  }
  mockBackend ??= new MockBackend();
  return { backend: mockBackend, keySource: null, forcedMock };
}

export type { ChatMessage, NextWordBackend, NextWordContext } from "./types";
