import type { Metadata } from "next";
import { Page } from "@/components/Page";
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from "./copy";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Rumi keeps on your device, what is sent to the AI, and what is saved if you turn on memory.",
};

export default function PrivacyPage() {
  return (
    <Page title="Privacy" intro={PRIVACY_INTRO}>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <p>{section.lines.join(" ")}</p>
        </section>
      ))}
    </Page>
  );
}
