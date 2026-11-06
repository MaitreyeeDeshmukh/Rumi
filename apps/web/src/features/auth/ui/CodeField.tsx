"use client";

import type { Ref } from "react";
import { cleanCode, CODE_LENGTH } from "../authController";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

/** The 6-digit field: digits only (letters and spaces are dropped as they are typed or pasted), and a phone offers the code from the email. */
export function CodeField({ id, error, inputRef }: { id: string; error: string | null; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div className={S.field}>
      <label htmlFor={id} className={S.label}>
        {AUTH_COPY.code.label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? `${id}-error` : `${id}-hint`}
        className={`${S.input} ${S.code}`}
        onChange={(e) => {
          e.currentTarget.value = cleanCode(e.currentTarget.value).slice(0, CODE_LENGTH);
        }}
      />
      {error !== null ? (
        <p id={`${id}-error`} className={S.fieldError}>
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className={S.hint}>
          {AUTH_COPY.code.hint}
        </p>
      )}
    </div>
  );
}
