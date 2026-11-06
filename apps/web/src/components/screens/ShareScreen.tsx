"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { SHARE } from "@/content/share";
import { SHARE_IDS, availableShare, buildShareText, type ShareSelection } from "@/features/adapters/share";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

const subscribeNever = () => () => {};
const hasShare = () => typeof navigator.share === "function";

/** /share: pick sections, see the exact text, copy it. One text value feeds the preview and the clipboard. */
export function ShareScreen() {
  const { state } = useRumi();
  const page = PAGES["/share"];
  const [selection, setSelection] = useState<ShareSelection>({});
  const [status, setStatus] = useState("");
  const preview = useRef(null as HTMLPreElement | null);
  const canShare = useSyncExternalStore(subscribeNever, hasShare, () => false);

  const available = availableShare(state);
  const text = buildShareText(selection, state);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(SHARE.copied);
    } catch {
      // No clipboard here: select the text so the person can copy it by hand.
      const node = preview.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      setStatus(SHARE.copyFailed);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ text });
    } catch {
      // The person closed the share sheet: nothing to report.
    }
  };

  return (
    <Screen title={page.h1} lead={page.lead}>
      <div data-needs-js className="grid gap-6">
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-xl font-bold text-ink">{SHARE.legend}</legend>
          {SHARE_IDS.map((id) => (
            <div key={id} className="flex min-h-11 flex-wrap items-center gap-x-3">
              <Checkbox
                id={`share-${id}`}
                checked={Boolean(selection[id]) && available[id]}
                disabled={!available[id]}
                aria-describedby={available[id] ? undefined : `share-${id}-why`}
                onCheckedChange={(v) => {
                  setSelection((s) => ({ ...s, [id]: v === true }));
                  setStatus("");
                }}
              />
              <label htmlFor={`share-${id}`} className="cursor-pointer font-bold text-ink">
                {SHARE.sections[id]}
              </label>
              {available[id] ? null : (
                <span id={`share-${id}-why`} className="text-sm text-muted-ink">
                  {SHARE.unavailable}
                </span>
              )}
            </div>
          ))}
        </fieldset>

        <section aria-labelledby="share-preview-title" className="grid gap-2">
          <h2 id="share-preview-title" className="m-0 text-xl">
            {SHARE.previewTitle}
          </h2>
          <pre
            ref={preview}
            id="share-preview"
            aria-live="polite"
            className="share-preview m-0 min-h-24 rounded-card border-2 border-line bg-surface p-4 text-base whitespace-pre-wrap text-ink [font-family:inherit]"
          >
            {text || SHARE.nothingSelected}
          </pre>
          <p className="note m-0">{SHARE.note}</p>
        </section>

        <StickyActions>
          <div className="grid gap-3">
            <Button kind="primary" block disabled={!text} aria-describedby="share-preview" onClick={copy}>
              {SHARE.copy}
            </Button>
            {canShare ? (
              <Button kind="secondary" block disabled={!text} aria-describedby="share-preview" onClick={share}>
                {SHARE.share}
              </Button>
            ) : null}
          </div>
        </StickyActions>
        <p role="status" className="note m-0 min-h-6">
          {status}
        </p>
      </div>
    </Screen>
  );
}
