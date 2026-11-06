import type { Metadata } from "next";
import { PAGES_COPY } from "@/content/pages";
import { SITE } from "@/lib/site";

/** Everything the spec's route table (section 4.8) says about one route. */
export type PageMeta = {
  title: string;
  navTitle?: string;
  h1: string;
  lead: string;
  description: string;
  /** The heading and lead of the empty state, where the page has one (/kit). */
  empty?: { h1: string; lead: string };
  primary: string | Readonly<Record<string, string>> | null;
};

export const PAGES: Readonly<Record<string, PageMeta>> = PAGES_COPY;

/** The route's metadata: a bare title (the root template adds the site name) or an absolute one for "/". */
export function metadataFor(route: string): Metadata {
  const page = PAGES[route];
  if (!page) throw new Error(`Unknown route ${route}`);
  return {
    title: route === "/" ? { absolute: page.title } : page.title,
    description: page.description,
    // Each page shares its own title and description, not the home page's from the root layout.
    openGraph: { title: page.title, description: page.description, siteName: SITE.name, type: "website" },
  };
}

/** The label of a route whose primary action is one fixed label (not a map by state). */
export function primaryLabel(route: string): string {
  const primary = PAGES[route]?.primary;
  if (typeof primary !== "string") throw new Error(`primary:${route}`);
  return primary;
}
