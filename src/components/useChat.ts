"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Booking, PendingAction } from "@/lib/bookings/types";
import { emptyItinerary, type BudgetSummary, type ChatEvent, type Itinerary } from "@/lib/types";

export interface ToolActivity {
  id: string;
  label: string;
  status: "running" | "ok" | "failed";
  mock: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: ToolActivity[];
  error?: string;
  notice?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const STORAGE_KEY = "safar.conversationId";
const emptyBudget: BudgetSummary = { currency: "INR", lines: [], total: 0 };
let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

/** Chat state, the streaming request, and the live itinerary that the stream updates. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary>(emptyItinerary());
  const [budget, setBudget] = useState<BudgetSummary>(emptyBudget);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasModelKey, setHasModelKey] = useState(true);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setHasModelKey(data.hasModelKey !== false);
      setProviders(data.providers ?? {});
      setEphemeral(!!data.ephemeral);
    } catch {
      /* list is optional */
    }
  }, []);

  /** Bookings and unanswered confirmation cards for a conversation. */
  const refreshBookings = useCallback(async (id: string | null) => {
    if (!id) {
      setBookings([]);
      setPendingActions([]);
      return;
    }
    try {
      const res = await fetch(`/api/bookings?conversationId=${encodeURIComponent(id)}`);
      const data = await res.json();
      setBookings(data.bookings ?? []);
      setPendingActions(data.pending ?? []);
    } catch {
      /* bookings are optional to the chat */
    }
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      idRef.current = id;
      setConversationId(id);
      setMessages(
        (data.transcript as { role: "user" | "assistant"; text: string }[]).map((t) => ({ id: nextId(), ...t })),
      );
      setItinerary(data.itinerary);
      setBudget(data.budget);
      void refreshBookings(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {}
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [refreshBookings]);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (saved) void load(saved);
    else setLoading(false);
    void refreshList();
  }, [load, refreshList]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newTrip = useCallback(() => {
    abortRef.current?.abort();
    idRef.current = null;
    setConversationId(null);
    setMessages([]);
    setItinerary(emptyItinerary());
    setBudget(emptyBudget);
    setBookings([]);
    setPendingActions([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    void refreshList();
  }, [refreshList]);

  const send = useCallback(
    async (text: string, opts: { voice?: boolean; onText?: (delta: string) => void } = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
        { id: assistantId, role: "assistant", text: "", tools: [] },
      ]);
      setBusy(true);

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      const handle = (event: ChatEvent) => {
        switch (event.type) {
          case "conversation":
            idRef.current = event.id;
            setConversationId(event.id);
            try {
              localStorage.setItem(STORAGE_KEY, event.id);
            } catch {}
            break;
          case "text":
            opts.onText?.(event.delta);
            patch((m) => ({ ...m, text: m.text + event.delta }));
            break;
          case "tool_start":
            patch((m) => ({
              ...m,
              // Text after a lookup starts a new paragraph instead of running on.
              text: m.text && !m.text.endsWith("\n") ? `${m.text}\n\n` : m.text,
              tools: [...(m.tools ?? []), { id: event.id, label: event.label, status: "running", mock: false }],
            }));
            break;
          case "tool_end":
            patch((m) => ({
              ...m,
              tools: (m.tools ?? []).map((t) =>
                t.id === event.id ? { ...t, status: event.ok ? "ok" : "failed", mock: event.mock } : t,
              ),
            }));
            break;
          case "itinerary":
            setItinerary(event.itinerary);
            setBudget(event.budget);
            break;
          case "error":
            patch((m) => ({ ...m, error: event.message }));
            break;
          case "notice":
            patch((m) => ({ ...m, notice: event.message }));
            break;
          case "confirm":
            // A newer proposal replaces any unanswered one.
            setPendingActions([event.action]);
            break;
          case "profile":
          case "done":
            break;
        }
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: idRef.current, message: trimmed, voice: opts.voice }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            for (const line of frame.split("\n")) {
              if (line.startsWith("data: ")) handle(JSON.parse(line.slice(6)) as ChatEvent);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          patch((m) => ({
            ...m,
            error: err instanceof Error && err.message ? `Could not reach Safar: ${err.message}` : "Could not reach Safar.",
          }));
        }
      } finally {
        // Mark any tool still spinning as stopped, e.g. after an interruption.
        patch((m) => ({
          ...m,
          tools: (m.tools ?? []).map((t) => (t.status === "running" ? { ...t, status: "failed" } : t)),
        }));
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
          void refreshList();
        }
      }
    },
    [refreshList],
  );

  /** Re-send the last message after a failure, without showing it twice. */
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Drop the failed exchange from view; the server keeps its own record.
    setMessages((prev) => {
      const i = prev.lastIndexOf(lastUser);
      return i >= 0 ? prev.slice(0, i) : prev;
    });
    void send(lastUser.text);
  }, [messages, send]);

  /** The traveller answered a confirmation card. Only this path ever makes or changes a booking. */
  const answerAction = useCallback(
    async (actionId: string, confirm: boolean) => {
      setActionBusy(true);
      let note: string;
      try {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: confirm ? "confirm" : "decline", actionId }),
        });
        const data = await res.json();
        note = res.ok
          ? confirm
            ? `I pressed confirm. ${data.message}`
            : "I decided not to go ahead with that."
          : `I tried to confirm, but it did not go through: ${data.error ?? "unknown error"}`;
      } catch {
        note = "I tried to confirm, but the app could not reach the server.";
      }
      setPendingActions((prev) => prev.filter((a) => a.id !== actionId));
      await refreshBookings(idRef.current);
      setActionBusy(false);
      // Tell the agent what happened so it can carry on from the real outcome.
      await send(note);
    },
    [refreshBookings, send],
  );

  return {
    messages,
    itinerary,
    budget,
    conversationId,
    conversations,
    busy,
    loading,
    hasModelKey,
    providers,
    ephemeral,
    pendingActions,
    bookings,
    actionBusy,
    answerAction,
    retry,
    send,
    stop,
    newTrip,
    load,
  };
}
