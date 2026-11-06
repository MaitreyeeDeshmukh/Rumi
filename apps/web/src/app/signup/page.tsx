import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { safeNextPath } from "@/features/auth/nextPath";
import { S } from "@/features/auth/ui/styles";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Make a Rumi account with your email and a password to keep your choices on any device.",
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  return (
    <article className={S.page}>
      <h1>{AUTH_COPY.signup.title}</h1>
      <p className="intro">{AUTH_COPY.signup.intro}</p>
      <AuthForm mode="signup" next={next} />
    </article>
  );
}
