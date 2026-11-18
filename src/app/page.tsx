"use client";

import Link from "next/link";
import { useState } from "react";
import { Chat } from "@/components/Chat";
import { ItineraryPanel } from "@/components/ItineraryPanel";
import { useChat } from "@/components/useChat";
import { useVoice } from "@/components/useVoice";

export default function Home() {
  const chat = useChat();
  const voice = useVoice(chat);
  const [tab, setTab] = useState<"chat" | "plan">("chat");
  const planCount = chat.itinerary.days.length + chat.itinerary.flights.length + chat.itinerary.stays.length;
  const sources = Object.entries(chat.providers).filter(([k]) => k !== "transfers");
  const mocked = sources.filter(([, v]) => v === "mock").map(([k]) => k);
  const dataBadge =
    sources.length === 0 || mocked.length === 0
      ? null
      : mocked.length === sources.length
        ? "Sample data: no live travel providers connected"
        : `Sample data for: ${mocked.join(", ")}`;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-card/80 px-4 py-2.5 sm:px-6">
        <span className="font-display text-xl tracking-tight">
          Safar<span className="text-saffron">.</span>
        </span>
        {dataBadge && (
          <span className="hidden rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs text-saffron md:inline">{dataBadge}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {chat.conversations.length > 0 && (
            <>
              <label htmlFor="trip-select" className="sr-only">
                Open a saved trip
              </label>
              <select
                id="trip-select"
                value={chat.conversationId ?? ""}
                onChange={(e) => e.target.value && void chat.load(e.target.value)}
                className="hidden h-9 max-w-56 rounded-lg border border-line bg-card px-2 text-sm md:block"
              >
                <option value="">Saved trips…</option>
                {chat.conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <Link href="/trips" className="h-9 shrink-0 rounded-lg border border-line bg-card px-2.5 text-sm font-medium leading-9 hover:border-saffron sm:px-3">
            <span className="sm:hidden">Trips</span>
            <span className="hidden sm:inline">My trips</span>
          </Link>
          <Link href="/settings" className="h-9 shrink-0 rounded-lg border border-line bg-card px-2.5 text-sm font-medium leading-9 hover:border-saffron sm:px-3">
            Profile
          </Link>
          <button
            type="button"
            onClick={chat.newTrip}
            className="h-9 shrink-0 rounded-lg border border-line bg-card px-2.5 text-sm font-medium hover:border-saffron sm:px-3"
          >
            New trip
          </button>
        </div>
      </header>

      {chat.ephemeral && (
        <p className="border-b border-line bg-saffron-soft px-4 py-1.5 text-center text-xs text-saffron sm:px-6">
          Hosted demo: trips, bookings and your profile are stored temporarily and can reset at any time.
        </p>
      )}

      {/* Phone: one pane at a time. Desktop: side by side. */}
      <nav className="grid grid-cols-2 border-b border-line text-sm lg:hidden" aria-label="View">
        {(["chat", "plan"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`py-2.5 font-medium ${tab === t ? "border-b-2 border-saffron text-ink" : "text-muted"}`}
          >
            {t === "chat" ? "Chat" : `Plan${planCount ? ` (${planCount})` : ""}`}
          </button>
        ))}
      </nav>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        <div className={`min-h-0 ${tab === "chat" ? "" : "hidden"} lg:block`}>
          <Chat
            messages={chat.messages}
            busy={chat.busy}
            loading={chat.loading}
            hasModelKey={chat.hasModelKey}
            onSend={(text) => void chat.send(text)}
            onStop={chat.stop}
            voice={voice}
            pendingActions={chat.pendingActions}
            actionBusy={chat.actionBusy}
            onAnswerAction={(id, ok) => void chat.answerAction(id, ok)}
            onRetry={chat.retry}
          />
        </div>
        <aside className={`min-h-0 border-line bg-card/50 lg:border-l ${tab === "plan" ? "" : "hidden"} lg:block`} aria-label="Itinerary">
          <ItineraryPanel
            itinerary={chat.itinerary}
            budget={chat.budget}
            bookings={chat.bookings}
            exportHref={chat.conversationId ? `/export?id=${encodeURIComponent(chat.conversationId)}` : undefined}
          />
        </aside>
      </main>
    </div>
  );
}
