"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PendingAction } from "@/lib/bookings/types";
import type { ChatMessage } from "./useChat";
import type { VoiceControls } from "./useVoice";

const STARTERS = [
  "A long weekend in Goa in December for two of us, from Delhi",
  "Five days in Jaipur and Udaipur with my parents, relaxed pace",
  "Somewhere warm outside India in January, under Rs 1.5 lakh for two",
];

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Tiny formatter: paragraphs, "- " bullets, **bold** and [text](https://link). Anything else shows as written. */
function renderText(text: string): ReactNode {
  const bold = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      const href = link ? safeHref(link[2]) : null;
      if (link && href) {
        return (
          <a key={`${key}-${i}`} href={href} target="_blank" rel="noopener noreferrer" className="text-teal underline underline-offset-2">
            {link[1]}
          </a>
        );
      }
      return <span key={`${key}-${i}`}>{link ? link[1] : part}</span>;
    });
  return text.split(/\n{2,}/).map((block, bi) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      return (
        <ul key={bi} className="list-disc space-y-1 pl-5">
          {lines.map((l, li) => (
            <li key={li}>{bold(l.replace(/^\s*[-•]\s+/, ""), `${bi}-${li}`)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="whitespace-pre-wrap">
        {bold(block, String(bi))}
      </p>
    );
  });
}

function ToolChips({ message }: { message: ChatMessage }) {
  if (!message.tools?.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="What Safar looked up">
      {message.tools.map((t) => (
        <li
          key={t.id}
          className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-xs text-muted"
        >
          {t.status === "running" ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-saffron border-t-transparent" aria-hidden />
          ) : (
            <span aria-hidden className={t.status === "ok" ? "text-teal" : "text-saffron"}>
              {t.status === "ok" ? "✓" : "!"}
            </span>
          )}
          <span>{t.label}</span>
          {t.status === "failed" && <span className="text-saffron">did not finish</span>}
          {t.mock && <span className="rounded bg-saffron-soft px-1 text-[10px] font-medium text-saffron">sample data</span>}
        </li>
      ))}
    </ul>
  );
}

function formatAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.abs(amount));
  } catch {
    return `${currency} ${Math.abs(amount).toLocaleString("en-IN")}`;
  }
}

/** The one place a booking, change or cancellation is approved. The agent cannot press these buttons. */
function ConfirmCard({ action, busy, onAnswer }: { action: PendingAction; busy: boolean; onAnswer: (confirm: boolean) => void }) {
  const s = action.summary;
  const destructive = action.type === "cancel";
  return (
    <section aria-label="Needs your confirmation" className="mx-auto mt-4 max-w-2xl rounded-2xl border-2 border-saffron/60 bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-saffron">Needs your confirmation</p>
      <h2 className="mt-1 font-display text-lg">{s.title}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {s.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm font-medium tabular-nums">
        {s.amount > 0 ? "Total to pay: " : s.amount < 0 ? "Refund to you: " : "Nothing to pay: "}
        {formatAmount(s.amount, s.currency)}
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
        {s.terms.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className={`h-10 rounded-xl px-4 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50 ${destructive ? "bg-saffron" : "bg-teal"}`}
        >
          {s.confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer(false)} className="h-10 rounded-xl border border-line px-4 text-sm font-medium hover:border-saffron disabled:opacity-50">
          {destructive ? "Keep the booking" : "Not now"}
        </button>
      </div>
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

const PHASE_TEXT = { idle: "", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking. Start talking to interrupt." } as const;

/** Voice status, the hands-free switch, and what is being heard. */
function VoiceBar({ voice }: { voice: VoiceControls }) {
  if (!voice.support) return null;
  if (!voice.support.listen) {
    return (
      <p className="mx-auto mb-2 max-w-2xl text-xs text-muted">
        Voice input is not available in this browser, so Safar is text only here. It works in Chrome, Edge and Safari.
      </p>
    );
  }
  const active = voice.phase !== "idle";
  return (
    <div className="mx-auto mb-2 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <label className="flex cursor-pointer items-center gap-2 text-muted">
        <input type="checkbox" role="switch" checked={voice.handsFree} onChange={voice.toggleHandsFree} className="h-4 w-4 accent-[var(--color-saffron)]" />
        Hands-free
      </label>
      <span role="status" aria-live="polite" className={`flex min-w-0 flex-1 items-center gap-1.5 ${active ? "text-ink" : "text-muted"}`}>
        {active && <span className={`h-2 w-2 shrink-0 rounded-full ${voice.phase === "listening" ? "bg-saffron" : "bg-teal"} ${voice.phase !== "thinking" ? "animate-pulse" : ""}`} aria-hidden />}
        <span className="truncate">
          {voice.error ?? (voice.interim ? `“${voice.interim}”` : PHASE_TEXT[voice.phase] || (voice.handsFree ? "" : "Hold the mic to talk, or switch on hands-free."))}
        </span>
      </span>
      {voice.phase === "speaking" && (
        <button type="button" onClick={voice.hush} className="shrink-0 rounded-md border border-line px-2 py-0.5 font-medium hover:border-saffron">
          Stop speaking
        </button>
      )}
      {!voice.support.speak && <span className="text-muted">Replies cannot be read aloud in this browser.</span>}
    </div>
  );
}

export function Chat(props: {
  messages: ChatMessage[];
  busy: boolean;
  loading: boolean;
  hasModelKey: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  voice: VoiceControls;
  pendingActions: PendingAction[];
  actionBusy: boolean;
  onAnswerAction: (id: string, confirm: boolean) => void;
  onRetry: () => void;
}) {
  const { messages, busy, loading, hasModelKey, onSend, onStop, voice, pendingActions, actionBusy, onAnswerAction, onRetry } = props;
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingActions]);

  const submit = () => {
    if (!draft.trim() || busy) return;
    onSend(draft);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Conversation">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {!hasModelKey && (
          <div role="alert" className="mb-4 rounded-xl border border-saffron/40 bg-saffron-soft px-4 py-3 text-sm">
            <strong>No Anthropic API key found.</strong> Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> on your machine, or
            to the project&rsquo;s environment variables on Vercel, then restart or redeploy. Until then Safar cannot reply.
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted">Loading your trip…</p>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-[8vh] max-w-md">
            <h1 className="font-display text-4xl leading-tight">Where to next?</h1>
            <p className="mt-3 text-muted">
              Tell me roughly what you have in mind. I&rsquo;ll ask what I need, find options, and build the plan beside
              us as we talk.
            </p>
            <ul className="mt-6 space-y-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => onSend(s)}
                    disabled={busy}
                    className="w-full rounded-xl border border-line bg-card px-4 py-3 text-left text-sm transition hover:border-saffron hover:bg-saffron-soft/40 disabled:opacity-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const waiting = m.role === "assistant" && isLast && busy && !m.text;
              return (
                <li key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-paper">
                      {m.text}
                    </div>
                  ) : (
                    <div className="max-w-[92%]">
                      {m.notice && <p className="mb-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-muted">{m.notice}</p>}
                      <ToolChips message={m} />
                      {m.text && (
                        <div className="space-y-3 rounded-2xl rounded-bl-md border border-line bg-card px-4 py-3 text-[15px] leading-relaxed">
                          {renderText(m.text)}
                        </div>
                      )}
                      {waiting && !m.error && (
                        <div className="inline-flex gap-1 rounded-2xl border border-line bg-card px-4 py-3.5" aria-label="Safar is thinking">
                          {[0, 1, 2].map((d) => (
                            <span key={d} className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" style={{ animationDelay: `${d * 0.18}s` }} />
                          ))}
                        </div>
                      )}
                      {m.error && (
                        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-saffron/40 bg-saffron-soft px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1">{m.error}</span>
                          {isLast && !busy && (
                            <button type="button" onClick={onRetry} className="h-8 shrink-0 rounded-lg border border-saffron/50 bg-card px-3 text-sm font-medium hover:border-saffron">
                              Try again
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {pendingActions.map((a) => (
          <ConfirmCard key={a.id} action={a} busy={actionBusy || busy} onAnswer={(ok) => onAnswerAction(a.id, ok)} />
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-line bg-card/70 px-4 py-3 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <VoiceBar voice={voice} />
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          {voice.support?.listen && (
            <button
              type="button"
              aria-label="Hold to talk"
              title="Hold to talk"
              aria-pressed={voice.holding}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                voice.press();
              }}
              onPointerUp={voice.release}
              onPointerCancel={voice.release}
              onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), voice.press())}
              onKeyUp={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), voice.release())}
              onContextMenu={(e) => e.preventDefault()}
              className={`grid h-11 w-11 shrink-0 touch-none select-none place-items-center rounded-xl border transition ${
                voice.holding ? "border-saffron bg-saffron text-white" : "border-line bg-card hover:border-saffron"
              }`}
            >
              <MicIcon />
            </button>
          )}
          <label htmlFor="safar-input" className="sr-only">
            Message Safar
          </label>
          <textarea
            id="safar-input"
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Tell Safar about your trip…"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] outline-none placeholder:text-muted focus:border-saffron"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => {
                voice.hush();
                onStop();
              }}
              className="h-11 rounded-xl border border-line bg-card px-4 text-sm font-medium hover:border-saffron"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="h-11 rounded-xl bg-saffron px-4 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
