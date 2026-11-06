import { describe, expect, it } from "vitest";
import {
  CONTACT_TOPICS,
  LONG_LINK,
  MAX_MESSAGE,
  MIN_MESSAGE,
  buildMailto,
  buildPlainMessage,
  isLongLink,
  validateContact,
} from "@/lib/contact";

const SHORT = "Write a message first. Use at least 10 characters.";
const LONG = "Your message is too long. Use 1000 characters or fewer.";

describe("validateContact", () => {
  it("rejects an empty, a 9-character and a whitespace-only message", () => {
    expect(validateContact({ message: "" })).toBe(SHORT);
    expect(validateContact({ message: "123456789" })).toBe(SHORT);
    expect(validateContact({ message: "          \n\n      " })).toBe(SHORT);
  });

  it("accepts 10 characters and exactly the maximum", () => {
    expect(validateContact({ message: "1234567890" })).toBeNull();
    expect(validateContact({ message: "a".repeat(MAX_MESSAGE) })).toBeNull();
  });

  it("rejects 1001 characters", () => {
    expect(validateContact({ message: "a".repeat(MAX_MESSAGE + 1) })).toBe(LONG);
  });

  it("exports the limits and the four topics", () => {
    expect([MIN_MESSAGE, MAX_MESSAGE, LONG_LINK]).toEqual([10, 1000, 1800]);
    expect(CONTACT_TOPICS).toEqual([
      { value: "question", label: "A question" },
      { value: "feedback", label: "Feedback" },
      { value: "working-together", label: "Working together" },
      { value: "problem", label: "A problem with Rumi" },
    ]);
  });
});

describe("buildMailto", () => {
  it("builds the exact link, with CRLF line breaks encoded", () => {
    expect(buildMailto({ email: "team@rumi.test", name: "Sam", topic: "feedback", message: "Line 1\nLine 2 é" })).toBe(
      "mailto:team@rumi.test?subject=Rumi%3A%20Feedback&body=Name%3A%20Sam%0D%0A%0D%0ALine%201%0D%0ALine%202%20%C3%A9%0D%0A%0D%0ASent%20from%20the%20Rumi%20contact%20page.",
    );
  });

  it("leaves out the Name line when there is no name", () => {
    for (const name of [undefined, "", "   "]) {
      const url = new URL(buildMailto({ email: "team@rumi.test", name, topic: "question", message: "Hello there, team" }));
      expect(url.searchParams.get("body")).toBe("Hello there, team\r\n\r\nSent from the Rumi contact page.");
    }
  });

  it("starts with the closing line when there is no name and no message (the link without JavaScript)", () => {
    const url = new URL(buildMailto({ email: "team@rumi.test", topic: "question", message: "" }));
    expect(url.searchParams.get("body")).toBe("Sent from the Rumi contact page.");
  });

  it("round-trips reserved characters", () => {
    const url = new URL(buildMailto({ email: "team@rumi.test", topic: "problem", message: "a&b?c#d%e" }));
    expect(url.searchParams.get("body")).toContain("a&b?c#d%e");
    expect(url.searchParams.get("subject")).toBe("Rumi: A problem with Rumi");
  });

  it("turns CRLF and CR in the message into one CRLF each", () => {
    const url = new URL(buildMailto({ email: "team@rumi.test", topic: "question", message: "one\r\ntwo\rthree" }));
    expect(url.searchParams.get("body")).toContain("one\r\ntwo\r\nthree");
  });
});

describe("isLongLink", () => {
  it("is true for 1000 accented characters with line breaks", () => {
    const message = `${"é".repeat(1000)}${"\n".repeat(20)}`;
    expect(isLongLink(buildMailto({ email: "team@rumi.test", topic: "question", message }))).toBe(true);
  });

  it("is false for 100 plain characters", () => {
    expect(isLongLink(buildMailto({ email: "team@rumi.test", topic: "question", message: "a".repeat(100) }))).toBe(false);
  });
});

describe("buildPlainMessage", () => {
  it("is the decoded body with \\n line breaks", () => {
    const input = { email: "team@rumi.test", name: "Sam", topic: "feedback" as const, message: "Line 1\nLine 2 é" };
    const body = new URL(buildMailto(input)).searchParams.get("body") ?? "";
    expect(buildPlainMessage(input)).toBe(body.replace(/\r\n/g, "\n"));
    expect(buildPlainMessage(input)).not.toContain("\r");
  });
});
