"use client";

import { useState } from "react";

/** Copies text. When the browser refuses, the text in `pre` is selected so the person can copy it by hand. */
export function useCopy(copiedText: string, failedText: string) {
  const [message, setMessage] = useState("");
  const copy = async (text: string, pre: HTMLElement | null) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(copiedText);
    } catch {
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setMessage(failedText);
    }
  };
  return { message, copy, clear: () => setMessage("") };
}
