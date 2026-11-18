"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isEchoOfSpeech, SentenceBuffer } from "@/lib/voice/text";
import type { Recognizer, Speaker, VoiceErrorCode, VoiceProvider } from "@/lib/voice/types";
import { createWebSpeechProvider } from "@/lib/voice/web-speech";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";

const ERROR_TEXT: Record<VoiceErrorCode, string> = {
  "not-allowed": "Microphone access is blocked. Allow it for this site in your browser, then try again.",
  "no-microphone": "No microphone was found.",
  network: "Speech recognition needs an internet connection and could not reach its service.",
  unsupported: "This browser does not support speech recognition. Try Chrome, Edge or Safari.",
  other: "Voice input stopped unexpectedly. Try again.",
};

interface ChatApi {
  send: (text: string, opts?: { voice?: boolean; onText?: (delta: string) => void }) => Promise<void>;
  stop: () => void;
}

/**
 * Voice mode on top of the chat: push-to-talk, a hands-free loop, spoken
 * replies that start as soon as the first sentence arrives, and barge-in
 * (speaking while Safar talks stops it and takes your new request).
 */
export function useVoice(chat: ChatApi, makeProvider: () => VoiceProvider = createWebSpeechProvider) {
  const [support, setSupport] = useState<{ listen: boolean; speak: boolean } | null>(null);
  const [phase, setPhaseState] = useState<VoicePhase>("idle");
  const [handsFree, setHandsFree] = useState(false);
  const [holding, setHolding] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const provider = useRef<VoiceProvider | null>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const phaseRef = useRef<VoicePhase>("idle");
  const handsFreeRef = useRef(false);
  const holdingRef = useRef(false);
  const heard = useRef(""); // push-to-talk transcript so far
  const spoken = useRef(""); // what Safar has said aloud this turn, for the echo check
  const turn = useRef(0); // increments per request so stale callbacks are ignored
  const pendingSpeech = useRef(0);
  const replyDone = useRef(true);
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  });

  const setPhase = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const listenContinuously = useCallback(() => {
    if (!handsFreeRef.current) return;
    recognizer.current?.start({ continuous: true });
  }, []);

  /** Called when a reply has been fully spoken, or cut short. */
  const settle = useCallback(() => {
    setInterim("");
    setPhase(handsFreeRef.current ? "listening" : "idle");
  }, []);

  /** Stop Safar mid-reply: silence it and cancel the request. */
  const bargeIn = useCallback(() => {
    turn.current++;
    speaker.current?.cancel();
    pendingSpeech.current = 0;
    replyDone.current = true;
    spoken.current = "";
    chatRef.current.stop();
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const mine = ++turn.current;
      const buffer = new SentenceBuffer();
      spoken.current = "";
      pendingSpeech.current = 0;
      replyDone.current = false;
      setInterim("");
      setPhase("thinking");

      const maybeFinish = () => {
        if (mine === turn.current && replyDone.current && pendingSpeech.current === 0) settle();
      };
      const say = (sentences: string[]) => {
        for (const s of sentences) {
          if (mine !== turn.current) return;
          spoken.current += ` ${s}`;
          pendingSpeech.current++;
          setPhase("speaking");
          speaker.current?.speak(s, () => {
            if (mine !== turn.current) return;
            pendingSpeech.current--;
            maybeFinish();
          });
        }
      };

      await chatRef.current.send(text, { voice: true, onText: (delta) => mine === turn.current && say(buffer.push(delta)) });
      if (mine !== turn.current) return; // interrupted while waiting
      say(buffer.flush());
      replyDone.current = true;
      maybeFinish();
    },
    [settle],
  );

  // Set up the provider in the browser only, so server and first client render match.
  useEffect(() => {
    const p = makeProvider();
    provider.current = p;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capability detection needs the browser
    setSupport({ listen: p.canListen, speak: p.canSpeak });
    speaker.current = p.createSpeaker();
    if (p.canListen) {
      recognizer.current = p.createRecognizer({
        onInterim: (text) => {
          const busy = phaseRef.current === "speaking" || phaseRef.current === "thinking";
          // While Safar is talking the mic also hears Safar. Only real new speech interrupts.
          if (busy && isEchoOfSpeech(text, spoken.current)) return;
          if (busy && text.length >= 3) {
            bargeIn();
            setPhase("listening");
          }
          setInterim(holdingRef.current ? `${heard.current} ${text}`.trim() : text);
        },
        onFinal: (text) => {
          if (holdingRef.current || !handsFreeRef.current) {
            heard.current = `${heard.current} ${text}`.trim();
            setInterim(heard.current);
            return;
          }
          if ((phaseRef.current === "speaking" || phaseRef.current === "thinking") && isEchoOfSpeech(text, spoken.current)) return;
          if (phaseRef.current !== "listening") bargeIn();
          void ask(text);
        },
        onError: (code) => {
          setError(ERROR_TEXT[code]);
          handsFreeRef.current = false;
          holdingRef.current = false;
          setHandsFree(false);
          setHolding(false);
          if (phaseRef.current === "listening") setPhase("idle");
        },
        onEnd: () => {
          if (holdingRef.current) return; // released: handled in release()
          // The browser ends recognition after a silence; hands-free keeps it going.
          if (handsFreeRef.current) window.setTimeout(listenContinuously, 150);
        },
      });
    }
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM node
      turn.current++;
      recognizer.current?.abort();
      speaker.current?.cancel();
    };
  }, [makeProvider, ask, bargeIn, listenContinuously]);

  /** Push-to-talk: call on press. */
  const press = useCallback(() => {
    if (!provider.current?.canListen || holdingRef.current) return;
    setError(null);
    bargeIn();
    heard.current = "";
    holdingRef.current = true;
    setHolding(true);
    setInterim("");
    setPhase("listening");
    recognizer.current?.start({ continuous: true });
  }, [bargeIn]);

  /** Push-to-talk: call on release. Sends what was heard. */
  const release = useCallback(() => {
    if (!holdingRef.current) return;
    recognizer.current?.stop();
    // Give the recogniser a moment to deliver its last words before sending.
    window.setTimeout(() => {
      holdingRef.current = false;
      setHolding(false);
      const text = heard.current.trim();
      heard.current = "";
      if (text) void ask(text);
      else settle();
      if (handsFreeRef.current) window.setTimeout(listenContinuously, 200);
    }, 450);
  }, [ask, settle, listenContinuously]);

  const toggleHandsFree = useCallback(() => {
    if (!provider.current?.canListen) return;
    setError(null);
    const next = !handsFreeRef.current;
    handsFreeRef.current = next;
    setHandsFree(next);
    if (next) {
      if (phaseRef.current === "idle") setPhase("listening");
      listenContinuously();
    } else {
      recognizer.current?.abort();
      if (phaseRef.current === "listening") setPhase("idle");
      setInterim("");
    }
  }, [listenContinuously]);

  /** Stop talking and listening without sending anything. */
  const hush = useCallback(() => {
    bargeIn();
    settle();
  }, [bargeIn, settle]);

  return { support, phase, handsFree, holding, interim, error, press, release, toggleHandsFree, hush, dismissError: () => setError(null) };
}

export type VoiceControls = ReturnType<typeof useVoice>;
