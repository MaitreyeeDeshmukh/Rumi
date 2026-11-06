import { SitePage } from "@/components/SitePage";
import { PAGES, metadataFor } from "@/lib/pages";
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from "./copy";

export const metadata = metadataFor("/privacy");

// Wording comes from ./copy, which was written to match what the system really stores. Keep it the single source of truth.
export default function PrivacyPage() {
  return (
    <SitePage title={PAGES["/privacy"].h1} lead={PRIVACY_INTRO}>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="font-bold">{section.heading}</h2>
          <p>{section.lines.join(" ")}</p>
        </section>
      ))}
    </SitePage>
  );
}
