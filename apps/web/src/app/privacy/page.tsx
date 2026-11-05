import type { Metadata } from "next";
import { Page } from "@/components/Page";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the Rumi preview stores, where it stays, and how to clear it.",
};

export default function PrivacyPage() {
  return (
    <Page title="Privacy" intro="Plain answers about your information.">
      <h2>What the preview stores</h2>
      <p>
        The preview saves your choices and any notes you type in your own browser, on your own device. It does not send
        them to us or to anyone else.
      </p>
      <h2>How to clear it</h2>
      <p>In the preview, open You, then Your data, then Clear all demo data. Clearing your browser data also removes it.</p>
      <h2>Please use sample information</h2>
      <p>Until accounts and protections are in place, please do not enter real health details.</p>
    </Page>
  );
}
