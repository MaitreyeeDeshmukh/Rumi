import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { safeNextPath } from "@/features/auth/nextPath";
import { AuthPanel } from "@/components/marketing/AuthPanel";
import { Screen } from "@/components/ui/screen";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Rumi with your email and password to use your saved choices on any device.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  return (
    <Screen title={AUTH_COPY.login.title} lead={AUTH_COPY.login.intro} aside={<AuthPanel />} footer={false}>
      <div className="max-w-md"><AuthForm mode="login" next={next} /></div>
    </Screen>
  );
}
