import { Actions, Section } from "@/components/marketing/Section";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { ABOUT } from "@/content/about";
import { PAGES, metadataFor } from "@/lib/pages";
import { TEAM } from "@/lib/team";

export const metadata = metadataFor("/about");

export default function AboutPage() {
  const page = PAGES["/about"];
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <Section id="why" title={ABOUT.why.h2}>
        <p>{ABOUT.why.text}</p>
      </Section>
      {/* Never filled with made-up names: the section appears only when src/lib/team.ts has real ones. */}
      {TEAM.length > 0 ? (
        <Section id="who" title={ABOUT.who.h2}>
          <p>{ABOUT.who.text}</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {TEAM.map((m) => (
              <li key={m.name}>
                <strong>{m.name}</strong>, {m.role}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section id="tested" title={ABOUT.tested.h2}>
        <p>{ABOUT.tested.text}</p>
      </Section>
      <Section id="ai" title={ABOUT.ai.h2}>
        <p>{ABOUT.ai.text}</p>
        <ButtonLink kind="tertiary" href="/safety" className="-ml-2">
          {ABOUT.ai.link}
        </ButtonLink>
      </Section>
      <Section id="contact" title={ABOUT.contact.h2}>
        <p>{ABOUT.contact.text}</p>
        <ButtonLink kind="tertiary" href="/contact" className="-ml-2">
          {ABOUT.contact.link}
        </ButtonLink>
      </Section>
      <Actions className="mt-12">
        <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
      </Actions>
    </SitePage>
  );
}
