import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  type Fetch,
  PermissionDeniedError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { cookies } from "next/headers";
import { selectBackend } from "./backends";
import { vocab } from "./vocab";

/** httpOnly cookie holding a key the user entered in the UI. Page scripts can't read it. */
export const API_KEY_COOKIE = "jevgpt_api_key";

export async function getUserKey(): Promise<string | undefined> {
  return (await cookies()).get(API_KEY_COOKIE)?.value || undefined;
}

export function checkKeyFormat(key: string): string | null {
  if (!key) return "Enter an API key.";
  if (key.length > 256 || /\s/.test(key)) return "That doesn't look like an API key.";
  return null;
}

export type KeyCheck =
  | { ok: true; warning?: string }
  | { ok: false; status: number; error: string };

/**
 * Ask TypeSafe whether the key works by listing models. Only a definite auth failure or an
 * unreachable API blocks saving; other API errors save the key with a warning.
 */
export async function verifyApiKey(apiKey: string, fetch?: Fetch): Promise<KeyCheck> {
  const client = new TypeSafeClient({ apiKey, fetch, timeout: 8000, retry: { maxRetries: 0 }, logLevel: "off" });
  try {
    await client.models.list();
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
      return { ok: false, status: 401, error: "TypeSafe rejected this key." };
    }
    if (err instanceof APIConnectionError) {
      return { ok: false, status: 502, error: "Couldn't reach TypeSafe to check the key. Try again." };
    }
    if (err instanceof TypeSafeError) {
      const detail = err instanceof APIError ? ` (HTTP ${err.status})` : "";
      return { ok: true, warning: `Couldn't fully verify the key${detail}, so it was saved anyway.` };
    }
    throw err;
  }
}

/** What the UI needs to know about the active backend. Never includes the full key. */
export function backendStatus(userKey: string | undefined) {
  const { backend, keySource, keyHint, forcedMock } = selectBackend(userKey);
  return {
    backend: backend.kind,
    model: backend.modelHint,
    keySource,
    keyHint,
    forcedMock,
    vocabSize: vocab.words.length,
    groups: vocab.groups.length,
  };
}
