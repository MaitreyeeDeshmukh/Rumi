"use client";

import { useState } from "react";
import { FAQ_COPY } from "@/content/faq";
import { Plus, Search, X } from "@/components/ui/icons";

/**
 * Questions and answers as native disclosure elements, all closed at first. They need no JavaScript, so there is
 * never a dead toggle, and Enter and Space work on the question. Opening one closes the others (shared name).
 * Spec 4.8 named a Radix accordion; Radix hides its closed answers from the page, so they vanish without JavaScript.
 * Each row is its own surface card. The optional search box only filters rows, so it is hidden without JavaScript.
 */
export function FaqList({ items, searchable = false }: { items: readonly { q: string; a: string }[]; searchable?: boolean }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.q} ${i.a}`.toLowerCase().includes(needle)) : items;
  return (
    <div>
      {searchable ? (
        <label data-needs-script className="mb-4 flex min-h-12 items-center gap-3 rounded-full border-2 border-line-strong bg-surface px-4 focus-within:border-focus">
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted-ink" />
          <span className="sr-only">{FAQ_COPY.searchLabel}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={FAQ_COPY.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-muted-ink"
          />
        </label>
      ) : null}
      <div className="grid gap-3">
        {shown.map((item) => (
          <details
            key={item.q}
            name="faq"
            data-faq-item
            data-faq-panel
            className="group rounded-[20px] border border-line bg-surface px-5 shadow-[var(--shadow)]"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-bold text-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <Plus aria-hidden="true" className="size-5 shrink-0 text-muted-ink group-open:hidden" />
              <X aria-hidden="true" className="hidden size-5 shrink-0 text-muted-ink group-open:block" />
            </summary>
            <p className="m-0 pb-4">{item.a}</p>
          </details>
        ))}
        {shown.length === 0 ? <p className="m-0 text-muted-ink">{FAQ_COPY.noMatch}</p> : null}
      </div>
    </div>
  );
}
