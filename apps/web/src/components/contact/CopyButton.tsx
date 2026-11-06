"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy } from "@/components/ui/icons";
import { CONTACT } from "@/content/contact";
import { useIsClient } from "@/hooks/useIsClient";

/** Select the text of an element so the person can copy it by hand when the clipboard is not available. */
function selectText(id: string): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
  } else if (el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

/**
 * A secondary button that copies text and says "Copied." in its own polite live region.
 * It renders only after JavaScript runs (a copy button without JavaScript would do nothing).
 */
export function CopyButton({
  label,
  text,
  selectId,
  className,
}: {
  label: string;
  text: string | (() => string);
  /** The element to select when copying fails. */
  selectId: string;
  className?: string;
}) {
  const isClient = useIsClient();
  const [status, setStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);

  // Stop the pending "Copied." timer when the button goes away.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let result: string = CONTACT.copied;
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
    } catch {
      selectText(selectId);
      result = CONTACT.copyFailed;
    }
    setStatus(result);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(""), 4000);
  }

  return (
    // The wrapper reserves the button's height on phones, so the page does not jump when the button appears.
    <div data-needs-script className={className}>
      {isClient ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="secondary" onClick={copy} className="w-full sm:w-auto">
            <Copy aria-hidden="true" className="size-5" />
            {label}
          </Button>
          <span role="status" className="text-sm font-bold text-ink">
            {status}
          </span>
        </div>
      ) : (
        <div className="min-h-12" />
      )}
    </div>
  );
}
