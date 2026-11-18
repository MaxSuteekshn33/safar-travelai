// Pure helpers for voice mode, kept free of browser APIs so they can be tested.

/** Turns a chat reply into something that reads well aloud: no markdown, links spoken as their text. */
export function toSpeakable(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/₹\s?/g, "rupees ")
    .replace(/\bRs\.?\s?(?=\d)/g, "rupees ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collects streamed text and releases it a sentence at a time, so speech can
 * start before the whole reply has arrived.
 */
export class SentenceBuffer {
  private pending = "";

  /** Add streamed text; returns any complete sentences now ready to speak. */
  push(delta: string): string[] {
    this.pending += delta;
    const out: string[] = [];
    // A sentence ends at . ! ? followed by space, or at a line break. Decimals like 2.5 are not split.
    const re = /[^]*?(?:[.!?]["')\]]?(?=\s)|\n+)/y;
    let consumed = 0;
    for (;;) {
      re.lastIndex = consumed;
      const m = re.exec(this.pending);
      if (!m) break;
      consumed = re.lastIndex;
      const sentence = toSpeakable(m[0]);
      if (sentence) out.push(sentence);
    }
    this.pending = this.pending.slice(consumed);
    return out;
  }

  /** The reply is complete: return whatever is left. */
  flush(): string[] {
    const rest = toSpeakable(this.pending);
    this.pending = "";
    return rest ? [rest] : [];
  }
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/**
 * While Safar is speaking, the microphone can pick up its own voice. Treat
 * what was heard as an echo if those words appear, in order, in what Safar
 * has just been saying.
 */
export function isEchoOfSpeech(heard: string, spoken: string): boolean {
  const h = words(heard);
  if (h.length === 0) return true;
  return ` ${words(spoken).join(" ")} `.includes(` ${h.join(" ")} `);
}
