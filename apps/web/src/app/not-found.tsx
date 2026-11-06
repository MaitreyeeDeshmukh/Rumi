import type { Metadata } from "next";
import { SitePage } from "@/components/SitePage";
import { SiteChrome } from "@/components/nav/SiteChrome";
import { ButtonLink } from "@/components/ui/button";
import { NOT_FOUND } from "@/content/pages";

export const metadata: Metadata = { title: NOT_FOUND.title, description: NOT_FOUND.description };

export default function NotFound() {
  return (
    <SiteChrome>
      <SitePage title={NOT_FOUND.h1} lead={NOT_FOUND.lead}>
        <ButtonLink kind="primary" arrow href="/">
          {NOT_FOUND.primary}
        </ButtonLink>
      </SitePage>
    </SiteChrome>
  );
}
