import { permanentRedirect } from "next/navigation";
import { signInUrl } from "@/lib/auth/gate";

/** The old magic-link page. Kept so bookmarks and old emails still land on the log-in page, with a safe `?next=` carried over. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  permanentRedirect(next ? signInUrl(next) : "/login");
}
