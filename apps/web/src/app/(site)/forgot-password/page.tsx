import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { AuthPanel } from "@/components/marketing/AuthPanel";
import { Screen } from "@/components/ui/screen";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Ask for an email link to choose a new Rumi password.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <Screen title={AUTH_COPY.forgot.title} lead={AUTH_COPY.forgot.intro} aside={<AuthPanel />} footer={false}>
      <div className="max-w-md"><ForgotPasswordForm /></div>
    </Screen>
  );
}
