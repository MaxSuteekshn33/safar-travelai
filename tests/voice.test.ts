import { describe, expect, it } from "vitest";
import { isEchoOfSpeech, SentenceBuffer, toSpeakable } from "@/lib/voice/text";

describe("speech text", () => {
  it("strips markdown and links and reads rupee amounts naturally", () => {
    expect(toSpeakable("**Flights:** about ₹11,100. See [the blog](https://x.example/a) or https://y.example.")).toBe("Flights: about rupees 11,100. See the blog or");
    expect(toSpeakable("- First\n- Second")).toBe("First Second");
    expect(toSpeakable("Rs 4,000 cheaper")).toBe("rupees 4,000 cheaper");
  });
});

describe("sentence buffer for streamed speech", () => {
  it("releases whole sentences as text streams in and holds the unfinished one", () => {
    const b = new SentenceBuffer();
    expect(b.push("The cheapest fli")).toEqual([]);
    expect(b.push("ght is 9,995. It lands at 2")).toEqual(["The cheapest flight is 9,995."]);
    expect(b.push(".30 am! Want")).toEqual(["It lands at 2.30 am!"]);
    expect(b.push(" it?")).toEqual([]);
    expect(b.flush()).toEqual(["Want it?"]);
    expect(b.flush()).toEqual([]);
  });

  it("splits on line breaks and skips empty pieces", () => {
    const b = new SentenceBuffer();
    expect(b.push("Day one\n\n- **Beach**\n")).toEqual(["Day one", "Beach"]);
  });
});

describe("echo check for barge-in", () => {
  const spoken = "The cheapest flight is nine thousand rupees. It lands at two thirty.";
  it("ignores the microphone hearing Safar's own words", () => {
    expect(isEchoOfSpeech("cheapest flight is nine", spoken)).toBe(true);
    expect(isEchoOfSpeech("It lands at two-thirty", spoken)).toBe(true);
    expect(isEchoOfSpeech("", spoken)).toBe(true);
  });
  it("treats different words as the traveller interrupting", () => {
    expect(isEchoOfSpeech("no wait", spoken)).toBe(false);
    expect(isEchoOfSpeech("flight cheapest", spoken)).toBe(false);
    expect(isEchoOfSpeech("stop", "")).toBe(false);
  });
});
