import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessCode, accessToken, sameString } from "@/lib/access";

/** Gate for a hosted copy: without the access code, no page or API responds. */
export async function proxy(request: NextRequest) {
  const code = accessCode();
  if (!code) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/unlock" || pathname === "/api/unlock") return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (cookie && sameString(cookie, await accessToken(code))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "This copy of Safar needs an access code. Open the site and enter it." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/unlock", request.url));
}

export const config = {
  // Everything except Next's own static files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
