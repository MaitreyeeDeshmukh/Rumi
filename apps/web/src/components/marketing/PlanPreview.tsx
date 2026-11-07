import type { CSSProperties } from "react";
import { HOME } from "@/content/home";

/** Three cards in the real card style with made-up lines. It is not the Get ready screen: no headings, buttons, links or inputs. */
export function PlanPreview() {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 px-1 text-sm font-bold text-muted-ink">{HOME.preview.title}</p>
      {HOME.preview.cards.map((card, i) => (
        <div key={card.label} style={{ "--i": i } as CSSProperties} className="hero-card rounded-card border border-line bg-surface p-3">
          <p className="m-0 text-sm font-bold text-muted-ink">{card.label}</p>
          <p className="my-1 text-ink">{card.text}</p>
          <span style={{ "--i": i } as CSSProperties} className="hero-tag inline-flex min-h-7 items-center rounded-full border border-line bg-lav px-2.5 text-sm font-semibold text-ink">
            {card.tag}
          </span>
        </div>
      ))}
    </div>
  );
}
