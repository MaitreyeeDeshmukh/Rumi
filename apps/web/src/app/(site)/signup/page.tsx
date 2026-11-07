import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { safeNextPath } from "@/features/auth/nextPath";
import { AuthPanel } from "@/components/marketing/AuthPanel";
import { Screen } from "@/components/ui/screen";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Make a Rumi account with your email and a password to keep your choices on any device.",
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  return (
    <Screen title={AUTH_COPY.signup.title} lead={AUTH_COPY.signup.intro} aside={<AuthPanel />} footer={false}>
      <div className="max-w-md"><AuthForm mode="signup" next={next} /></div>
    </Screen>
  );
}
