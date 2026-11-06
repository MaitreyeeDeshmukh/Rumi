"use client";

import type { ReactNode } from "react";
import { AppointmentDetail, AppointmentsList, NewAppointment } from "@/components/more/appointments";
import { MoreHub } from "@/components/more/MoreHub";
import { NotFound } from "@/components/more/parts";
import { RecordVisit, VisitDetail, VisitsList } from "@/components/more/visits";
import { Screen } from "@/components/ui/screen";
import { MORE } from "@/content/more";

type Route = (a: string | undefined, b: string | undefined) => ReactNode;

/** One entry per preview feature: the screen for /home/feature/a/b. Null means no such screen. */
const ROUTES: Readonly<Record<string, Route>> = {
  more: (a) => (a ? null : <MoreHub />),
  visits: (a) => (!a ? <VisitsList /> : a === "record" ? <RecordVisit /> : <VisitDetail id={a} />),
  appointments: (a) => (!a ? <AppointmentsList /> : a === "new" ? <NewAppointment /> : <AppointmentDetail id={a} />),
};

const missing = () => (
  <Screen title={MORE.notFoundTitle} lead={MORE.notFoundText}>
    <NotFound />
  </Screen>
);

/** Picks the preview screen. The page has already checked the feature name. */
export function MoreRouter({ path }: { path: string[] }) {
  const [feature, a, b] = path;
  const route = ROUTES[feature ?? ""];
  return <>{(route && route(a, b)) || missing()}</>;
}
