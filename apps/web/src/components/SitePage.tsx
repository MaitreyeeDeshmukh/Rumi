import type { ReactNode } from "react";

/** The h1 and lead of a site page; the chrome supplies Back, the page-enter wrapper and the footer. */
export function SitePage({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <>
      <h1 tabIndex={-1}>{title}</h1>
      <p className="intro">{lead}</p>
      {children}
    </>
  );
}
