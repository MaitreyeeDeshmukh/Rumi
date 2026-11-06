"use client";

import { useId, useState, type MouseEvent } from "react";
import { CopyButton } from "@/components/contact/CopyButton";
import { ButtonLink } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { CONTACT } from "@/content/contact";
import {
  CONTACT_TOPICS,
  MAX_MESSAGE,
  buildMailto,
  buildPlainMessage,
  isLongLink,
  validateContact,
  type ContactTopic,
} from "@/lib/contact";
import { primaryLabel } from "@/lib/pages";

/** Character counts at which the hidden live region speaks. */
const LIMIT_NOTICES = [800, 900, 1000];

/**
 * Name, topic and message. The primary action is a real mailto: link whose href is rebuilt on every change.
 * Its click only calls preventDefault when the message is not valid; otherwise the browser opens the email app.
 */
export function ContactForm({ email }: { email: string }) {
  const id = useId();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState(CONTACT_TOPICS[0].value);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const href = buildMailto({ email, name, topic, message });
  const messageId = `${id}-message`;
  const counterId = `${id}-counter`;
  const plainId = `${id}-plain`;
  const plain = buildPlainMessage({ name, message });
  // The visible counter is silent. This text changes only at three points, so screen readers hear it rarely.
  const milestone = LIMIT_NOTICES.filter((n) => message.length >= n).at(-1);

  function changeMessage(value: string) {
    setMessage(value);
    if (error && validateContact({ message: value }) === null) setError("");
  }

  function open(event: MouseEvent<HTMLAnchorElement>) {
    const problem = validateContact({ message });
    if (problem) {
      event.preventDefault();
      setError(problem);
      setSent(false);
      document.getElementById(messageId)?.focus();
      return;
    }
    setError("");
    setSent(true);
  }

  return (
    <section aria-labelledby="contact-form-heading">
      <h2 id="contact-form-heading" className="mt-0">
        {CONTACT.form.heading}
      </h2>
      {/* Typing here would not reach the link without JavaScript, so the fields hide and the note shows. */}
      <div data-needs-script className="grid gap-4">
        <Field id={`${id}-name`} label={CONTACT.form.name}>
          <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={fieldControlClass} />
        </Field>
        <Field id={`${id}-topic`} label={CONTACT.form.topic}>
          <select value={topic} onChange={(e) => setTopic(e.target.value as ContactTopic)} className={fieldControlClass}>
            {CONTACT_TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={messageId} label={CONTACT.form.message} hint={CONTACT.form.messageHint} error={error || undefined}>
          {(field) => (
            <textarea
              {...field}
              aria-describedby={[field["aria-describedby"], counterId].filter(Boolean).join(" ")}
              rows={5}
              maxLength={MAX_MESSAGE}
              value={message}
              onChange={(e) => changeMessage(e.target.value)}
              className={`${fieldControlClass} field-sizing-content max-h-80 min-h-32 resize-y`}
            />
          )}
        </Field>
        <p id={counterId} className="m-0 text-sm text-muted-ink">
          {`${message.length} of ${MAX_MESSAGE}`}
        </p>
        <p aria-live="polite" className="sr-only">
          {milestone ? `${milestone} of ${MAX_MESSAGE}` : ""}
        </p>
      </div>
      <p data-no-script>{CONTACT.form.noScript}</p>
      <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-start">
        <ButtonLink kind="primary" href={href} onClick={open} className="w-full sm:w-auto">
          {primaryLabel("/contact")}
        </ButtonLink>
        <CopyButton label={CONTACT.form.copyMessage} text={plain} selectId={plainId} />
      </div>
      {/* The text "Copy my message" copies. It is selected when the clipboard is not available. */}
      <div id={plainId} aria-hidden="true" className="sr-only whitespace-pre-wrap">
        {plain}
      </div>
      <div aria-live="polite" className="mt-4 grid gap-3 empty:hidden">
        {sent ? <Notice tone="success">{CONTACT.notices.sent}</Notice> : null}
        {isLongLink(href) ? <Notice tone="info">{CONTACT.notices.long}</Notice> : null}
      </div>
    </section>
  );
}
