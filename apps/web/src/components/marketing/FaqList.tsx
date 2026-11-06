import { ChevronDown } from "@/components/ui/icons";

/**
 * Questions and answers as native disclosure elements, all closed at first. They need no JavaScript, so there is
 * never a dead toggle, and Enter and Space work on the question. Opening one closes the others (shared name).
 * Spec 4.8 named a Radix accordion; Radix hides its closed answers from the page, so they vanish without JavaScript.
 */
export function FaqList({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div data-faq-panel className="rounded-card border border-line bg-surface px-4">
      {items.map((item) => (
        <details key={item.q} name="faq" data-faq-item className="group border-b border-line last:border-b-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 font-bold text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <ChevronDown aria-hidden="true" className="size-5 shrink-0 group-open:rotate-180" />
          </summary>
          <p className="m-0 pb-3">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
