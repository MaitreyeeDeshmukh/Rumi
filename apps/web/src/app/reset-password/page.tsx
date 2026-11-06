import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/ui";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { S } from "@/features/auth/ui/styles";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Choose a new password for your Rumi account after using the email link.",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <article className={S.page}>
      <h1>{AUTH_COPY.reset.title}</h1>
      <p className="intro">{AUTH_COPY.reset.intro}</p>
      <ResetPasswordForm />
    </article>
  );
}
