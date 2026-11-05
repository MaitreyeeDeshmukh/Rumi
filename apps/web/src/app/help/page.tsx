import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/Page";

export const metadata: Metadata = {
  title: "Help",
  description: "Where to find help using Rumi, and where to go for urgent support.",
};

export default function HelpPage() {
  return (
    <Page title="Help" intro="Quick answers about using Rumi.">
      <h2>Trying Rumi</h2>
      <p>
        Open the <a href="/preview/index.html">interactive preview</a> in your phone&apos;s browser. Your choices stay
        on your device. You can clear them any time in the preview, under You, then Your data.
      </p>
      <h2>Is this real?</h2>
      <p>
        The preview is a working demo with sample information. The AI replies, bookings and chats in it are simulated.
        We say so on every screen where it applies.
      </p>
      <h2>Urgent support</h2>
      <p>
        If you or someone else may be in danger, go to <Link href="/safety">Safety and crisis help</Link>.
      </p>
    </Page>
  );
}
