"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PastTrip, TravelerProfile } from "@/lib/types";

type ListField = "airlineLikes" | "hotelLikes" | "interests" | "notes";
interface SavedTrip {
  id: string;
  title: string;
  updatedAt: string;
}

const BUDGET_STYLES = [
  ["", "Not set"],
  ["shoestring", "Shoestring"],
  ["value", "Good value"],
  ["comfort", "Comfort"],
  ["luxury", "Luxury"],
] as const;
const PACES = [
  ["", "Not set"],
  ["relaxed", "Relaxed"],
  ["balanced", "Balanced"],
  ["packed", "Packed"],
] as const;

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-card px-3 text-sm outline-none placeholder:text-muted focus:border-saffron";

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-display text-lg">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A text field that saves when you leave it or press Enter. */
function TextField(props: { label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  const [synced, setSynced] = useState(props.value);
  if (props.value !== synced) {
    // The saved value changed underneath us (load, or delete all): show it.
    setSynced(props.value);
    setDraft(props.value);
  }
  const commit = () => draft.trim() !== props.value && props.onSave(draft.trim());
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{props.label}</span>
      <input
        className={inputCls}
        value={draft}
        maxLength={80}
        placeholder={props.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function ChipList(props: { label: string; items: string[]; placeholder: string; maxLength?: number; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!props.items.some((i) => i.toLowerCase() === v.toLowerCase())) props.onChange([...props.items, v]);
    setDraft("");
  };
  return (
    <div>
      <h3 className="text-sm text-muted">{props.label}</h3>
      {props.items.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {props.items.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-sm">
              <span>{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => props.onChange(props.items.filter((i) => i !== item))}
                className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-saffron-soft hover:text-saffron"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">Nothing saved.</p>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className={inputCls}
          value={draft}
          maxLength={props.maxLength ?? 80}
          placeholder={props.placeholder}
          aria-label={`Add to ${props.label}`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()} className="h-10 shrink-0 rounded-lg border border-line px-3 text-sm font-medium hover:border-saffron disabled:opacity-40">
          Add
        </button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [tripDraft, setTripDraft] = useState<PastTrip>({ destination: "" });
  const saveSeq = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const [p, c] = await Promise.all([fetch("/api/profile"), fetch("/api/conversations")]);
        setProfile((await p.json()).profile ?? {});
        setTrips((await c.json()).conversations ?? []);
      } catch {
        setError("Could not load your profile. Is the server running?");
        setProfile({});
      }
    })();
  }, []);

  /** Applies a change locally, then saves the whole profile. */
  const save = useCallback(async (next: TravelerProfile) => {
    setProfile(next);
    setStatus("saving");
    setError(null);
    const seq = ++saveSeq.current;
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      if (seq === saveSeq.current) {
        setProfile(data.profile);
        setStatus("saved");
      }
    } catch (err) {
      if (seq === saveSeq.current) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Save failed");
      }
    }
  }, []);

  const wipe = async () => {
    setConfirmWipe(false);
    setStatus("saving");
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setProfile({});
      setStatus("saved");
    } catch {
      setStatus("error");
      setError("Could not delete the profile.");
    }
  };

  const deleteTrip = async (id: string) => {
    const before = trips;
    setTrips(trips.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      try {
        if (localStorage.getItem("safar.conversationId") === id) localStorage.removeItem("safar.conversationId");
      } catch {}
    } catch {
      setTrips(before);
      setError("Could not delete that trip.");
    }
  };

  if (!profile) {
    return <main className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted">Loading your profile…</main>;
  }

  const set = (patch: Partial<TravelerProfile>) => void save({ ...profile, ...patch });
  const setList = (field: ListField) => (items: string[]) => set({ [field]: items });
  const pastTrips = profile.pastTrips ?? [];
  const isEmpty = Object.keys(profile).length === 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card/90 px-4 py-2.5 backdrop-blur sm:px-6">
        <Link href="/" className="font-display text-xl tracking-tight">
          Safar<span className="text-saffron">.</span>
        </Link>
        <span className="text-sm text-muted">Settings</span>
        <span className="ml-auto text-xs text-muted" role="status" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Not saved" : ""}
        </span>
        <Link href="/" className="h-9 rounded-lg border border-line bg-card px-3 text-sm font-medium leading-9 hover:border-saffron">
          Back to chat
        </Link>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-3xl">What Safar remembers</h1>
          <p className="mt-2 text-sm text-muted">
            Safar adds to this as it gets to know you and uses it when planning later trips. Everything here is yours to
            change or delete, and changes save as you make them. It is stored only on this computer.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-saffron/40 bg-saffron-soft px-4 py-3 text-sm">
            {error}
          </p>
        )}

        <Card title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={profile.name ?? ""} onSave={(v) => set({ name: v })} />
            <TextField label="Home city" value={profile.homeCity ?? ""} placeholder="e.g. Delhi" onSave={(v) => set({ homeCity: v })} />
            <TextField label="Dietary preference" value={profile.dietary ?? ""} placeholder="e.g. vegetarian" onSave={(v) => set({ dietary: v })} />
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Budget style</span>
              <select className={inputCls} value={profile.budgetStyle ?? ""} onChange={(e) => set({ budgetStyle: (e.target.value || undefined) as TravelerProfile["budgetStyle"] })}>
                {BUDGET_STYLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Pace</span>
              <select className={inputCls} value={profile.pace ?? ""} onChange={(e) => set({ pace: (e.target.value || undefined) as TravelerProfile["pace"] })}>
                {PACES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Likes and preferences">
          <div className="space-y-6">
            <ChipList label="Interests" items={profile.interests ?? []} placeholder="e.g. beaches, street food" onChange={setList("interests")} />
            <ChipList label="Airlines you like" items={profile.airlineLikes ?? []} placeholder="e.g. IndiGo" onChange={setList("airlineLikes")} />
            <ChipList label="Hotels and stays you like" items={profile.hotelLikes ?? []} placeholder="e.g. small homestays" onChange={setList("hotelLikes")} />
            <ChipList label="Other notes" items={profile.notes ?? []} maxLength={240} placeholder="e.g. Avoids red-eye flights" onChange={setList("notes")} />
          </div>
        </Card>

        <Card title="Past trips" hint="Trips you have taken, so Safar can suggest something different or build on what you liked.">
          {pastTrips.length > 0 ? (
            <ul className="divide-y divide-line">
              {pastTrips.map((t, i) => (
                <li key={`${t.destination}-${t.when ?? ""}-${i}`} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{t.destination}</span>
                    {t.when && <span className="text-muted"> · {t.when}</span>}
                    {t.note && <span className="block text-muted">{t.note}</span>}
                  </span>
                  <button type="button" onClick={() => set({ pastTrips: pastTrips.filter((_, j) => j !== i) })} className="shrink-0 text-sm text-muted underline-offset-2 hover:text-saffron hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing saved.</p>
          )}
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tripDraft.destination.trim()) return;
              set({ pastTrips: [...pastTrips, tripDraft] });
              setTripDraft({ destination: "" });
            }}
          >
            <input className={inputCls} aria-label="Destination" placeholder="Destination" maxLength={80} value={tripDraft.destination} onChange={(e) => setTripDraft({ ...tripDraft, destination: e.target.value })} />
            <input className={inputCls} aria-label="When" placeholder="When, e.g. March 2025" maxLength={80} value={tripDraft.when ?? ""} onChange={(e) => setTripDraft({ ...tripDraft, when: e.target.value })} />
            <button type="submit" disabled={!tripDraft.destination.trim()} className="h-10 rounded-lg border border-line px-3 text-sm font-medium hover:border-saffron disabled:opacity-40">
              Add
            </button>
          </form>
        </Card>

        <Card title="Saved trips" hint="Conversations and itineraries you have planned with Safar. Deleting one removes its chat and plan for good.">
          {trips.length > 0 ? (
            <ul className="divide-y divide-line">
              {trips.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{t.title}</span>
                    <span className="block text-xs text-muted">Last updated {new Date(t.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </span>
                  <button type="button" onClick={() => void deleteTrip(t.id)} className="shrink-0 text-sm text-muted underline-offset-2 hover:text-saffron hover:underline">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No saved trips yet.</p>
          )}
        </Card>

        <Card title="Delete profile" hint="Removes everything on this page except saved trips. Safar will start from scratch next time.">
          {confirmWipe ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Delete the whole profile? This cannot be undone.</span>
              <button type="button" onClick={() => void wipe()} className="h-9 rounded-lg bg-saffron px-3 text-sm font-medium text-white">
                Yes, delete it
              </button>
              <button type="button" onClick={() => setConfirmWipe(false)} className="h-9 rounded-lg border border-line px-3 text-sm font-medium">
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" disabled={isEmpty} onClick={() => setConfirmWipe(true)} className="h-9 rounded-lg border border-saffron/50 px-3 text-sm font-medium text-saffron hover:bg-saffron-soft disabled:opacity-40">
              {isEmpty ? "Profile is empty" : "Delete everything Safar remembers"}
            </button>
          )}
        </Card>
      </main>
    </div>
  );
}
