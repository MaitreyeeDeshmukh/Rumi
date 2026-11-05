import type { Metadata } from "next";
import { Page } from "@/components/Page";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "How Rumi is designed for different ways of seeing, reading, moving and processing.",
};

export default function AccessibilityPage() {
  return (
    <Page title="Accessibility" intro="Rumi is built to be comfortable to use in different ways.">
      <ul className="list">
        <li>Three themes: Soft Focus, High Contrast and Low Light.</li>
        <li>Adjustable text size and a simplified view with fewer choices on screen.</li>
        <li>Read-aloud for text, always with the written version beside it.</li>
        <li>A reduced-motion setting, and no autoplay or flashing.</li>
        <li>Everything works with a keyboard and a screen reader, with clear focus outlines.</li>
      </ul>
      <p>If something does not work for you, please tell us so we can fix it.</p>
    </Page>
  );
}
