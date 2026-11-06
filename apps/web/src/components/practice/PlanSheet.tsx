"use client";

import { Sheet } from "@/components/ui/sheet";
import { PRACTICE } from "@/content/practice";
import type { PlanItem, VisitPlan } from "@/features/shared/types";

const SECTIONS: { kind: PlanItem["kind"]; title: string }[] = [
  { kind: "concern", title: PRACTICE.planConcern },
  { kind: "question", title: PRACTICE.planQuestion },
  { kind: "accommodation", title: PRACTICE.planAccommodation },
];

/** The enabled lines of the plan, grouped by kind. Opened from the call screen's Show my plan button. */
export function PlanSheet({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan: VisitPlan }) {
  const items = plan.items.filter((i) => i.enabled);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={PRACTICE.planTitle}>
      {items.length === 0 ? (
        <p className="m-0">{PRACTICE.planEmpty}</p>
      ) : (
        SECTIONS.map(({ kind, title }) => {
          const group = items.filter((i) => i.kind === kind);
          return group.length === 0 ? null : (
            <section key={kind}>
              <h3 className="mb-1 text-base">{title}</h3>
              <ul className="m-0 grid gap-1 pl-5">
                {group.map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Sheet>
  );
}
