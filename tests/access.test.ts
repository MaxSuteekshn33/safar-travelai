import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as unlock } from "@/app/api/unlock/route";
import { ACCESS_COOKIE, accessToken, sameString } from "@/lib/access";
import { proxy } from "@/proxy";

const req = (path: string, cookie?: string) => new NextRequest(`https://safar.example${path}`, { headers: cookie ? { cookie } : {} });
afterEach(() => {
  delete process.env.SAFAR_ACCESS_CODE;
});

describe("access code gate", () => {
  it("lets everything through when no code is configured", async () => {
    expect((await proxy(req("/api/chat"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("blocks APIs and redirects pages until the right cookie is present", async () => {
    process.env.SAFAR_ACCESS_CODE = "open-sesame";
    const api = await proxy(req("/api/chat"));
    expect(api.status).toBe(401);
    const page = await proxy(req("/trips"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://safar.example/unlock");
    expect((await proxy(req("/unlock"))).headers.get("x-middleware-next")).toBe("1");

    expect((await proxy(req("/api/chat", `${ACCESS_COOKIE}=wrong`))).status).toBe(401);
    const good = await proxy(req("/api/chat", `${ACCESS_COOKIE}=${await accessToken("open-sesame")}`));
    expect(good.headers.get("x-middleware-next")).toBe("1");
  });

  it("sets a hashed, http-only cookie only for the right code", async () => {
    process.env.SAFAR_ACCESS_CODE = "open-sesame";
    const post = (code: unknown) => unlock(new Request("https://safar.example/api/unlock", { method: "POST", body: JSON.stringify({ code }) }));
    const bad = await post("guess");
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect((await post(undefined)).status).toBe(401);

    const ok = await post(" open-sesame ");
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain(`${ACCESS_COOKIE}=${await accessToken("open-sesame")}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("open-sesame");
  });

  it("compares strings safely", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
  });
});
