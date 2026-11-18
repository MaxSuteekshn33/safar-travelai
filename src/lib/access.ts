// Optional shared access code for a hosted copy. When SAFAR_ACCESS_CODE is
// set, every page and API needs it; when it is not set, the app is open
// (the right default on your own machine).

export const ACCESS_COOKIE = "safar_access";

export function accessCode(): string | undefined {
  const code = process.env.SAFAR_ACCESS_CODE?.trim();
  return code ? code : undefined;
}

/** The cookie holds a hash of the code, never the code itself. */
export async function accessToken(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`safar-access:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking how many leading characters matched. */
export function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
