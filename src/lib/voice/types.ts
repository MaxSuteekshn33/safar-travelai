// Voice sits behind this interface so the browser Web Speech API can be
// swapped for a better engine later without touching the UI.

export interface RecognizerHandlers {
  /** Words heard so far in the current phrase; may change as recognition settles. */
  onInterim?: (text: string) => void;
  /** A finished phrase. */
  onFinal: (text: string) => void;
  onError?: (code: VoiceErrorCode) => void;
  /** Recognition stopped, whether asked to or not. */
  onEnd?: () => void;
}

export type VoiceErrorCode = "not-allowed" | "no-microphone" | "network" | "unsupported" | "other";

export interface Recognizer {
  /** continuous: keep listening across phrases (hands-free) instead of stopping after one. */
  start(opts: { continuous: boolean }): void;
  /** Stop and deliver what was heard. */
  stop(): void;
  /** Stop and discard. */
  abort(): void;
}

export interface Speaker {
  /** Queue a sentence to be spoken after anything already queued. */
  speak(text: string, onDone?: () => void): void;
  /** Stop speaking now and drop the queue. */
  cancel(): void;
}

export interface VoiceProvider {
  readonly name: string;
  readonly canListen: boolean;
  readonly canSpeak: boolean;
  createRecognizer(handlers: RecognizerHandlers): Recognizer;
  createSpeaker(): Speaker;
}
