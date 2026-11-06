"use client";

import { HomeSkeleton } from "@/components/home/HomeSkeleton";
import { HomeView } from "@/components/home/HomeView";
import { Screen } from "@/components/ui/screen";
import { HOME } from "@/content/dashboard";
import { PAGES } from "@/lib/pages";
import { useDashboardInput } from "@/features/home/useDashboardInput";
import { fill } from "@/lib/fill";

/** /home: the greeting, then the dashboard once the browser has loaded the saved state. */
export function HomeScreen() {
  const { ready, props } = useDashboardInput();
  const title = props.name ? fill(HOME.greetingName, { name: props.name }) : HOME.greeting;
  return (
    <Screen title={title} lead={PAGES["/home"].lead}>
      <div data-needs-js>{ready ? <HomeView {...props} /> : <HomeSkeleton />}</div>
    </Screen>
  );
}
