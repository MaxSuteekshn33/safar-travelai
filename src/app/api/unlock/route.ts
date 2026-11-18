import { ACCESS_COOKIE, accessCode, accessToken, sameString } from "@/lib/access";

/** POST { code } -> sets the access cookie if the code is right. */
export async function POST(request: Request) {
  const expected = accessCode();
  if (!expected) return Response.json({ ok: true });
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const given = typeof body?.code === "string" ? body.code.trim() : "";
  // A short fixed delay makes guessing slow without any stored state.
  await new Promise((r) => setTimeout(r, 400));
  if (!given || !sameString(given, expected)) {
    return Response.json({ error: "That code is not right." }, { status: 401 });
  }
  const token = await accessToken(expected);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ACCESS_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    },
  });
}
