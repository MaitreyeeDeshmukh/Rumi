import { Actions, BulletList, Section } from "@/components/marketing/Section";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { ACCESSIBILITY } from "@/content/accessibility";
import { PAGES, metadataFor, primaryLabel } from "@/lib/pages";

const ROUTE = "/accessibility";
export const metadata = metadataFor(ROUTE);

export default function AccessibilityPage() {
  const page = PAGES[ROUTE];
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <Section id="supports" title={ACCESSIBILITY.supports.h2} className="mt-8">
        <BulletList items={ACCESSIBILITY.supports.items} />
      </Section>
      <Section id="gaps" title={ACCESSIBILITY.gaps.h2}>
        <BulletList items={ACCESSIBILITY.gaps.items} />
      </Section>
      <Section id="report" title={ACCESSIBILITY.report.h2}>
        <p>{ACCESSIBILITY.report.text}</p>
        <Actions className="mt-4">
          <ButtonLink kind="primary" href="/contact" className="w-full sm:w-auto">
            {primaryLabel(ROUTE)}
          </ButtonLink>
        </Actions>
      </Section>
    </SitePage>
  );
}
