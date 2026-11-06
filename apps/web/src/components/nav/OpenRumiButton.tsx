"use client";

import { ButtonLink, type ButtonKind } from "@/components/ui/button";
import { NAV } from "@/content/nav";
import { useRumi } from "@/lib/rumiActive";

/** Always a real link. The server renders /welcome; once the saved state is loaded, people who finished setup get /home. */
export function OpenRumiButton({
  kind,
  chrome,
  block,
  className,
}: {
  kind: ButtonKind;
  chrome?: boolean;
  block?: boolean;
  className?: string;
}) {
  const { state } = useRumi();
  const href = state.settings.onboarded ? "/home" : "/welcome";
  return (
    <ButtonLink kind={kind} chrome={chrome} block={block} arrow={kind === "primary"} className={className} href={href}>
      {NAV.openRumi}
    </ButtonLink>
  );
}
