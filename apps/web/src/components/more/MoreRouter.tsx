"use client";

import type { ReactNode } from "react";
import { AppointmentDetail, AppointmentsList, NewAppointment } from "@/components/more/appointments";
import { CirclesHome, Comfort, EventDetail, GroupChat, GroupDetail, MeetupPrep } from "@/components/more/circles";
import { Contacts, Growth } from "@/components/more/you";
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
  circles: (a, b) => {
    if (!a) return <CirclesHome />;
    if (a === "comfort" && !b) return <Comfort />;
    if (!b) return null;
    if (a === "group") return <GroupDetail id={b} />;
    if (a === "chat") return <GroupChat id={b} />;
    if (a === "event") return <EventDetail id={b} />;
    return a === "prep" ? <MeetupPrep id={b} /> : null;
  },
  contacts: (a) => (a ? null : <Contacts />),
  growth: (a) => (a ? null : <Growth />),
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
