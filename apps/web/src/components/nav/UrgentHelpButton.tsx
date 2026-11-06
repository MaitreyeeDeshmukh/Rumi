"use client";

import type { MouseEvent } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { ButtonLink } from "@/components/ui/button";
import { ShieldAlert } from "@/components/ui/icons";
import { NAV } from "@/content/nav";

/**
 * A real link to /safety (works without JavaScript); with JavaScript it opens the crisis dialog.
 * A sheet passes onPress so it can close itself first.
 */
export function UrgentHelpButton({ chrome, onPress }: { chrome?: boolean; onPress?: () => void }) {
  const { show } = useCrisis();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    (onPress ?? show)();
  };
  return (
    <ButtonLink kind="urgent" chrome={chrome} href="/safety" onClick={onClick}>
      <ShieldAlert aria-hidden="true" className="size-5" />
      {NAV.urgentHelp}
    </ButtonLink>
  );
}
