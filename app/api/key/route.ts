import { cookies } from "next/headers";
import { API_KEY_COOKIE, backendStatus, checkKeyFormat, verifyApiKey } from "@/lib/api-key";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Verify a user-supplied TypeSafe key and store it in an httpOnly cookie. */
export async function POST(req: Request) {
  let apiKey = "";
  try {
    const body = await req.json();
    apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const formatError = checkKeyFormat(apiKey);
  if (formatError) return Response.json({ error: formatError }, { status: 400 });

  const check = await verifyApiKey(apiKey);
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  (await cookies()).set(API_KEY_COOKIE, apiKey, {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(req.url).protocol === "https:",
    path: "/api",
    maxAge: THIRTY_DAYS,
  });
  return Response.json({ ...backendStatus(apiKey), warning: check.warning });
}

/** Forget the user's key, which locks the chat until another key is entered. */
export async function DELETE() {
  (await cookies()).delete({ name: API_KEY_COOKIE, path: "/api" });
  return Response.json(backendStatus(undefined));
}
