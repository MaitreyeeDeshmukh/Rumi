"use client";

import { useEffect } from "react";
import { SitePage } from "@/components/SitePage";
import { SiteChrome } from "@/components/nav/SiteChrome";
import { Button, ButtonLink } from "@/components/ui/button";
import { NAV } from "@/content/nav";
import { ERROR_PAGE } from "@/content/pages";
import { SITE } from "@/lib/site";
import { reportClientError } from "@/lib/telemetry/reportClientError";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Only the digest is sent: never the message or stack.
  useEffect(() => reportClientError("render_error", error.digest), [error]);
  // A client component cannot export metadata, so the title is set here.
  useEffect(() => {
    document.title = `${ERROR_PAGE.title} | ${SITE.name}`;
  }, []);

  return (
    <SiteChrome>
      <SitePage title={ERROR_PAGE.h1} lead={ERROR_PAGE.lead}>
        <div className="flex flex-wrap gap-3">
          <Button kind="primary" onClick={() => reset()}>
            {NAV.tryAgain}
          </Button>
          <ButtonLink kind="secondary" href="/">
            {NAV.goHome}
          </ButtonLink>
        </div>
      </SitePage>
    </SiteChrome>
  );
}
