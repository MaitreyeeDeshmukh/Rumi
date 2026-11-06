import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { safeNextPath } from "@/features/auth/nextPath";
import { S } from "@/features/auth/ui/styles";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Rumi with your email and password to use your saved choices on any device.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  return (
    <article className={S.page}>
      <h1>{AUTH_COPY.login.title}</h1>
      <p className="intro">{AUTH_COPY.login.intro}</p>
      <AuthForm mode="login" next={next} />
    </article>
  );
}
