import { afterEach, describe, expect, it, vi } from "vitest";
import { backendStatus, checkKeyFormat, verifyApiKey } from "@/lib/api-key";
import { maskKey, selectBackend } from "@/lib/backends";

afterEach(() => vi.unstubAllEnvs());

describe("selectBackend", () => {
  it("uses the mock when there is no key anywhere", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(selectBackend()).toMatchObject({ keySource: null, forcedMock: false, backend: { kind: "mock" } });
  });

  it("uses the server key when set", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-server-key-1234");
    expect(selectBackend()).toMatchObject({ keySource: "env", keyHint: "sk-…1234", backend: { kind: "typesafe" } });
  });

  it("prefers a key entered in the UI over the server key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "sk-server-key-1234");
    const a = selectBackend("sk-user-key-abcd");
    expect(a).toMatchObject({ keySource: "user", keyHint: "sk-…abcd", backend: { kind: "typesafe" } });
    expect(selectBackend("sk-user-key-abcd").backend).toBe(a.backend); // cached per key
    expect(selectBackend("sk-other-key-wxyz").backend).not.toBe(a.backend);
  });

  it("ignores every key when JEV_BACKEND=mock", () => {
    vi.stubEnv("JEV_BACKEND", "mock");
    vi.stubEnv("TYPESAFE_API_KEY", "sk-server-key-1234");
    expect(selectBackend("sk-user-key-abcd")).toMatchObject({ keySource: null, forcedMock: true, backend: { kind: "mock" } });
  });

  it("never exposes the full key in the status", () => {
    const status = backendStatus("sk-secret-user-key-abcd");
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(maskKey("short")).toBe("…");
  });
});

describe("API key checks", () => {
  it("rejects empty or malformed keys before calling TypeSafe", () => {
    expect(checkKeyFormat("")).toMatch(/Enter/);
    expect(checkKeyFormat("sk key with spaces")).toMatch(/doesn't look/);
    expect(checkKeyFormat("sk-abc123")).toBeNull();
  });

  const respond = (status: number) => async () => new Response("{}", { status });

  it("accepts a key TypeSafe accepts", async () => {
    let auth: string | null = null;
    const fetch = async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return Response.json({ models: [{ name: "jev-1", description: "", release_date: "2026-09-15" }] });
    };
    expect(await verifyApiKey("sk-good", fetch)).toEqual({ ok: true });
    expect(auth).toContain("sk-good");
  });

  it("rejects a key TypeSafe refuses", async () => {
    expect(await verifyApiKey("sk-bad", respond(401))).toMatchObject({ ok: false, status: 401 });
    expect(await verifyApiKey("sk-bad", respond(403))).toMatchObject({ ok: false, status: 401 });
  });

  it("saves with a warning on other API errors, and fails when TypeSafe is unreachable", async () => {
    expect(await verifyApiKey("sk-x", respond(404))).toMatchObject({ ok: true, warning: expect.stringContaining("404") });
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await verifyApiKey("sk-x", offline)).toMatchObject({ ok: false, status: 502 });
  });
});
