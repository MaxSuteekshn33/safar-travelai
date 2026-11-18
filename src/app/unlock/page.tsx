"use client";

import { useState } from "react";

export default function UnlockPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (res.ok) {
        // A full reload, so the new cookie is sent with every request.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/";
        return;
      }
      setError((await res.json().catch(() => null))?.error ?? "That did not work.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <p className="font-display text-3xl tracking-tight">
        Safar<span className="text-saffron">.</span>
      </p>
      <h1 className="mt-6 font-display text-xl">Enter the access code</h1>
      <p className="mt-1 text-sm text-muted">This copy of Safar is private. Ask its owner for the code.</p>
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="access-code" className="sr-only">
          Access code
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-[15px] outline-none focus:border-saffron"
        />
        <button type="submit" disabled={busy || !code.trim()} className="h-11 rounded-xl bg-saffron px-4 text-sm font-medium text-white disabled:opacity-40">
          {busy ? "Checking…" : "Open"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-saffron">
          {error}
        </p>
      )}
    </main>
  );
}
