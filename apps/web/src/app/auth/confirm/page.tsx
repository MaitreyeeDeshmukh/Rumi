import type { Metadata } from "next";
import { ConfirmStatus } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { safeNextPath } from "@/features/auth/nextPath";
import { S } from "@/features/auth/ui/styles";

export const metadata: Metadata = {
  title: "Email confirmation",
  description: "Rumi confirms your email address after you open the link we sent you.",
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  return (
    <article className={S.page}>
      <h1>{AUTH_COPY.confirm.title}</h1>
      <ConfirmStatus next={next} />
    </article>
  );
}
