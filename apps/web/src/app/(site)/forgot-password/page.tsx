import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { S } from "@/features/auth/ui/styles";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Ask for an email link to choose a new Rumi password.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <article className={S.page}>
      <h1>{AUTH_COPY.forgot.title}</h1>
      <p className="intro">{AUTH_COPY.forgot.intro}</p>
      <ForgotPasswordForm />
    </article>
  );
}
