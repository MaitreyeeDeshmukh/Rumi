"use client";

import { useEffect, useRef, type Ref } from "react";
import { Eye, EyeOff } from "@/components/ui/icons";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

interface FieldProps {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  error: string | null;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** A visible label, the error under the field, and the hint, tied to the input with aria-describedby. */
export function TextField({ id, name, label, autoComplete, error, hint, inputRef }: FieldProps) {
  return (
    <div className={S.field}>
      <label htmlFor={id} className={S.label}>
        {label}
      </label>
        <input
        ref={inputRef}
        id={id}
        name={name}
        type="email"
        inputMode="email"
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={254}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? `${id}-error` : undefined}
        className={S.input}
      />
      {error !== null ? (
        <p id={`${id}-error`} className={S.fieldError}>
          {error}
        </p>
      ) : null}
      {hint ? <p className={S.hint}>{hint}</p> : null}
    </div>
  );
}

interface PasswordProps extends Omit<FieldProps, "name"> {
  name?: string;
  visible: boolean;
  /** Without it the field has no show/hide button (another field controls `visible`). */
  onToggle?: () => void;
}

/** A password field that is never filled in by the page and can be shown or hidden. The value is read from the form on submit, not kept in state. */
export function PasswordField({ id, name = "password", label, autoComplete, error, hint, inputRef, visible, onToggle }: PasswordProps) {
  const described = [error !== null ? `${id}-error` : null, hint ? `${id}-hint` : null].filter((v) => v !== null).join(" ");
  return (
    <div className={S.field}>
      <label htmlFor={id} className={S.label}>
        {label}
      </label>
      <div className={S.inputWrap}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={256}
          aria-invalid={error !== null}
          aria-describedby={described || undefined}
          className={onToggle ? `${S.input} ${S.inputPad}` : S.input}
        />
        {onToggle ? (
          <button
            type="button"
            className={S.eye}
            onClick={onToggle}
            aria-controls={id}
            aria-pressed={visible}
            aria-label={visible ? AUTH_COPY.fields.hide : AUTH_COPY.fields.show}
          >
            {visible ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
          </button>
        ) : null}
      </div>
      {error !== null ? (
        <p id={`${id}-error`} className={S.fieldError}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className={S.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The always-present live region for a problem the server reported. Setting `message` announces it and moves focus here,
 * so a keyboard or screen reader user lands on the problem. `tick` changes on every failure, so the same text twice still moves focus.
 */
export function ErrorRegion({ message, tick }: { message: string | null; tick: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message, tick]);
  return (
    <div ref={ref} role="alert" tabIndex={-1} className={message ? S.alert : undefined}>
      {message}
    </div>
  );
}
