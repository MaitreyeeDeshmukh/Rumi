import Link from "next/link";
import { Mascot } from "@/components/marketing/Mascot";
import { NAV } from "@/content/nav";
import { SITE } from "@/lib/site";

export function Logo() {
  return (
    <Link href="/" aria-label={NAV.logoLabel} className="inline-flex min-h-11 items-center gap-2 text-ink no-underline">
      <Mascot />
      <span className="font-[family-name:var(--font-display)] text-[1.4rem] font-bold whitespace-nowrap">{SITE.name}</span>
    </Link>
  );
}
