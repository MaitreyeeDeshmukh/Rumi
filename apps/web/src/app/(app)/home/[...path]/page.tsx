import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MoreRouter } from "@/components/more/MoreRouter";
import { MORE_TITLES } from "@/content/more";

/**
 * Preview tools from the prototype, under /home/:feature/... (for example /home/visits/record).
 * One dynamic route keeps every preview in new files: it adds no folder to the (app) group, so the sign-up gate,
 * nav and route lists stay as they are. /home/... is already gated by isAppPath. Crash reports from these pages
 * report as "unknown" on purpose (src/lib/telemetry/routes.ts), like any dynamic page.
 */
type Props = { params: Promise<{ path: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const title = MORE_TITLES[path[0] ?? ""];
  return title ? { title, robots: { index: false } } : {};
}

export default async function Page({ params }: Props) {
  const { path } = await params;
  if (!(path[0] && path[0] in MORE_TITLES) || path.length > 3) notFound();
  return <MoreRouter path={path} />;
}
