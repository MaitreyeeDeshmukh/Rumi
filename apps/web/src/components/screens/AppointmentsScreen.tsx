"use client";

import { useState } from "react";
import { ApptCard } from "@/components/appointments/parts";
import { ButtonLink } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { APPT } from "@/content/appointments";
import { splitAppointments } from "@/features/appointments/appointments";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

/** /appointments: upcoming and past visits, and the way to book one. */
export function AppointmentsScreen() {
  const { state, hydrated } = useRumi();
  const [now] = useState(() => new Date());
  const { upcoming, past } = splitAppointments(state.appointments ?? [], now);
  const none = upcoming.length + past.length === 0;
  return (
    <Screen title={PAGES["/appointments"].h1} lead={PAGES["/appointments"].lead}>
      <div data-needs-js>
        {!hydrated ? null : (
          <div className="grid gap-6">
            <ButtonLink kind="primary" arrow block href="/appointments/new">
              {APPT.book}
            </ButtonLink>
            {none ? (
              <div className="rounded-card border border-line bg-surface p-5">
                <h2 className="mt-0 mb-1 text-xl">{APPT.emptyTitle}</h2>
                <p className="m-0">{APPT.emptyBody}</p>
              </div>
            ) : null}
            {upcoming.length > 0 ? (
              <section className="grid gap-3">
                <h2 className="m-0 text-xl">{APPT.upcoming}</h2>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {upcoming.map((a) => (
                    <ApptCard key={a.id} a={a} />
                  ))}
                </ul>
              </section>
            ) : null}
            {past.length > 0 ? (
              <section className="grid gap-3">
                <h2 className="m-0 text-xl">{APPT.past}</h2>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {past.map((a) => (
                    <ApptCard key={a.id} a={a} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </Screen>
  );
}
