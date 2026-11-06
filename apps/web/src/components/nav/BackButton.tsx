"use client";

import { usePathname } from "next/navigation";
import { useNavStack } from "@/components/nav/NavHistoryProvider";
import { ButtonLink } from "@/components/ui/button";
import { ArrowLeft } from "@/components/ui/icons";
import { NAV } from "@/content/nav";
import { backAriaLabel, backHref } from "@/lib/nav";
import { PAGES } from "@/lib/pages";

export function BackButton() {
  const pathname = usePathname();
  const stack = useNavStack();
  const href = backHref(pathname, stack);
  if (href === null) return null;

  return (
    <ButtonLink
      kind="secondary"
      href={href}
      aria-label={backAriaLabel(href, (h) => PAGES[h]?.navTitle ?? PAGES[h]?.title)}
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
      {NAV.back}
    </ButtonLink>
  );
}
