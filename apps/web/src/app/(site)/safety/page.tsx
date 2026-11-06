import { Actions, BulletList, Section } from "@/components/marketing/Section";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { CRISIS } from "@/content/crisis";
import { SAFETY } from "@/content/safety";
import { PAGES, metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/safety");

export default function SafetyPage() {
  const page = PAGES["/safety"];
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <Section id="danger" title={SAFETY.danger.h2} className="mt-8">
        <p>{SAFETY.danger.text}</p>
        <Actions className="mt-4">
          <ButtonLink kind="primary" href="tel:988" className="w-full sm:w-auto">
            {CRISIS.call988}
          </ButtonLink>
          <ButtonLink kind="secondary" href="sms:988" className="w-full sm:w-auto">
            {CRISIS.text988}
          </ButtonLink>
          <ButtonLink kind="secondary" href="tel:911" className="w-full sm:w-auto">
            {CRISIS.call911}
          </ButtonLink>
        </Actions>
      </Section>
      <Section id="does" title={SAFETY.does.h2}>
        <BulletList items={SAFETY.does.items} />
      </Section>
      <Section id="does-not" title={SAFETY.doesNot.h2}>
        <BulletList items={SAFETY.doesNot.items} />
      </Section>
      <Section id="unsure" title={SAFETY.unsure.h2}>
        <p>{SAFETY.unsure.text}</p>
        <ButtonLink kind="tertiary" href="/contact" className="-ml-2">
          {SAFETY.unsure.link}
        </ButtonLink>
      </Section>
    </SitePage>
  );
}
