import { CONTACT } from "@/content/contact";

export const MIN_MESSAGE = 10;
export const MAX_MESSAGE = 1000;
/** Many email apps cut a mailto: link near 2000 characters; we warn a little earlier. */
export const LONG_LINK = 1800;

export type ContactTopic = "question" | "feedback" | "working-together" | "problem";

export const CONTACT_TOPICS: readonly { value: ContactTopic; label: string }[] = (
  ["question", "feedback", "working-together", "problem"] as const
).map((value) => ({ value, label: CONTACT.topics[value] }));

/** The error to show next to the message field, or null when the message can be sent. */
export function validateContact(input: { message: string }): string | null {
  const length = input.message.trim().length;
  if (length < MIN_MESSAGE) return CONTACT.errors.short;
  if (length > MAX_MESSAGE) return CONTACT.errors.long;
  return null;
}

type MessageInput = { name?: string; message: string };

const toLf = (text: string): string => text.replace(/\r\n?/g, "\n");

/** Name line (when given), the message, and the closing line, with \n line breaks. */
export function buildPlainMessage({ name, message }: MessageInput): string {
  const who = name?.trim();
  // Empty parts are left out, so an empty message (the link without JavaScript) does not start with blank lines.
  return [who ? `${CONTACT.mail.nameLabel}${who}` : "", toLf(message).trim(), CONTACT.mail.sentFrom]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** A mailto: link. Line breaks are CRLF (RFC 6068); subject and body are percent-encoded. */
export function buildMailto(input: { email: string; name?: string; topic: ContactTopic; message: string }): string {
  const topic = CONTACT_TOPICS.find((t) => t.value === input.topic)?.label ?? "";
  const subject = encodeURIComponent(`${CONTACT.mail.subjectPrefix}${topic}`);
  const body = encodeURIComponent(buildPlainMessage(input).replace(/\n/g, "\r\n"));
  return `mailto:${input.email}?subject=${subject}&body=${body}`;
}

export function isLongLink(url: string): boolean {
  return url.length > LONG_LINK;
}
