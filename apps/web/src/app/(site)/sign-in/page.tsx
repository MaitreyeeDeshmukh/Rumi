import type { Metadata } from "next";
import { SignInScreen } from "@/components/screens/SignInScreen";
import { SIGN_IN } from "@/content/signIn";
import { safeNext } from "@/lib/auth/gate";

export const metadata: Metadata = { title: SIGN_IN.title, description: SIGN_IN.lead };

/** The one place to sign up or sign in. `?next=` is checked here; the screen only ever sees a safe path or null. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <SignInScreen next={safeNext(next)} linkProblem={error === "link"} />;
}
