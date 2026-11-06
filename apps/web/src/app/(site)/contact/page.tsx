import { ContactForm } from "@/components/contact/ContactForm";
import { CopyButton } from "@/components/contact/CopyButton";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CONTACT } from "@/content/contact";
import { CRISIS } from "@/content/crisis";
import { contactEmail, isProduction } from "@/lib/env";
import { PAGES, metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/contact");

const card = "rounded-card border border-line bg-surface p-4";

/** A server component: the address comes from the build-time variable, and the build fails without it. */
export default function ContactPage() {
  const page = PAGES["/contact"];
  const email = contactEmail();
  if (!email) {
    if (isProduction()) throw new Error("NEXT_PUBLIC_CONTACT_EMAIL is required to build /contact");
    return (
      <SitePage title={page.h1} lead={page.lead}>
        <Notice tone="warn">{CONTACT.notices.missingEmail}</Notice>
      </SitePage>
    );
  }
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <div className="flex flex-wrap items-center gap-x-2">
        <p className="m-0">{CONTACT.emergencyLine}</p>
        <ButtonLink kind="tertiary" href="tel:988">
          {CRISIS.call988}
        </ButtonLink>
        <ButtonLink kind="tertiary" href="tel:911">
          {CRISIS.call911}
        </ButtonLink>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-start">
        <ContactForm email={email} />
        <div className="grid gap-6">
          <section aria-labelledby="contact-email-heading" className={card}>
            <h2 id="contact-email-heading" className="mt-0">
              {CONTACT.emailCard.heading}
            </h2>
            <p id="contact-email" className="font-bold break-all">
              {email}
            </p>
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start">
              <CopyButton label={CONTACT.emailCard.copy} text={email} selectId="contact-email" />
              <ButtonLink kind="secondary" href={`mailto:${email}`} className="w-full sm:w-auto">
                {CONTACT.emailCard.open}
              </ButtonLink>
            </div>
          </section>
          <section aria-labelledby="contact-emergency-heading" className={card}>
            <h2 id="contact-emergency-heading" className="mt-0">
              {CONTACT.emergencyCard.heading}
            </h2>
            <div className="grid gap-3">
              <ButtonLink kind="secondary" href="tel:988">
                {CRISIS.call988}
              </ButtonLink>
              <ButtonLink kind="secondary" href="sms:988">
                {CRISIS.text988}
              </ButtonLink>
              <ButtonLink kind="secondary" href="tel:911">
                {CRISIS.call911}
              </ButtonLink>
            </div>
          </section>
          <section aria-labelledby="contact-help-heading" className={card}>
            <h2 id="contact-help-heading" className="mt-0">
              {CONTACT.helpCard.heading}
            </h2>
            <ButtonLink kind="tertiary" href="/help" className="-ml-2">
              {CONTACT.helpCard.link}
            </ButtonLink>
          </section>
          <p className="m-0 text-sm text-muted-ink">{CONTACT.fine}</p>
        </div>
      </div>
    </SitePage>
  );
}
