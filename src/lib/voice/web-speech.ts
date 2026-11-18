import type { Recognizer, RecognizerHandlers, Speaker, VoiceErrorCode, VoiceProvider } from "./types";

// Minimal typings for the parts of the Web Speech API we use; the DOM lib does not ship them all.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERRORS: Record<string, VoiceErrorCode> = {
  "not-allowed": "not-allowed",
  "service-not-allowed": "not-allowed",
  "audio-capture": "no-microphone",
  network: "network",
};

class WebSpeechRecognizer implements Recognizer {
  private rec: SpeechRecognitionLike | null = null;

  constructor(
    private Ctor: SpeechRecognitionCtor,
    private handlers: RecognizerHandlers,
    private lang: string,
  ) {}

  start({ continuous }: { continuous: boolean }) {
    this.abort();
    const rec = new this.Ctor();
    rec.lang = this.lang;
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) this.handlers.onFinal(text);
        } else interim += r[0].transcript;
      }
      if (interim.trim()) this.handlers.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are normal: silence, or we stopped it ourselves.
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.handlers.onError?.(ERRORS[e.error] ?? "other");
    };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      this.handlers.onEnd?.();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.handlers.onError?.("other");
    }
  }

  stop() {
    this.rec?.stop();
  }

  abort() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  }
}

class WebSpeechSpeaker implements Speaker {
  private generation = 0;

  constructor(private lang: string) {}

  private pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === this.lang) ??
      voices.find((v) => v.lang.startsWith("en-IN")) ??
      voices.find((v) => v.lang.startsWith("en-GB")) ??
      voices.find((v) => v.lang.startsWith("en"))
    );
  }

  speak(text: string, onDone?: () => void) {
    const mine = this.generation;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    const voice = this.pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.03;
    // After cancel(), late end events from dropped utterances must not count.
    const done = () => mine === this.generation && onDone?.();
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  cancel() {
    this.generation++;
    window.speechSynthesis.cancel();
  }
}

/** Voice through the browser's built-in Web Speech API: free, no key, quality varies by browser. */
export function createWebSpeechProvider(lang = "en-IN"): VoiceProvider {
  const Ctor = recognitionCtor();
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  return {
    name: "web-speech",
    canListen: !!Ctor,
    canSpeak,
    createRecognizer(handlers) {
      if (!Ctor) throw new Error("Speech recognition is not supported in this browser");
      return new WebSpeechRecognizer(Ctor, handlers, lang);
    },
    createSpeaker() {
      if (!canSpeak) return { speak: (_t, onDone) => onDone?.(), cancel: () => {} };
      return new WebSpeechSpeaker(lang);
    },
  };
}
