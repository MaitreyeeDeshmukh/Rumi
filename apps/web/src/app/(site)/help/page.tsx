import { FaqList } from "@/components/marketing/FaqList";
import { Actions } from "@/components/marketing/Section";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { FAQ } from "@/content/faq";
import { PAGES, metadataFor, primaryLabel } from "@/lib/pages";

const ROUTE = "/help";
export const metadata = metadataFor(ROUTE);

export default function HelpPage() {
  const page = PAGES[ROUTE];
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <div className="mt-6">
        <FaqList items={FAQ} />
      </div>
      <Actions className="mt-8">
        <ButtonLink kind="primary" arrow href="/contact" className="w-full sm:w-auto">
          {primaryLabel(ROUTE)}
        </ButtonLink>
      </Actions>
    </SitePage>
  );
}
