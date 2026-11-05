import type { Metadata } from "next";
import { Page } from "@/components/Page";

export const metadata: Metadata = {
  title: "Safety and crisis help",
  description: "If you are in danger or thinking about hurting yourself, here is who to call or text right now.",
};

export default function SafetyPage() {
  return (
    <Page title="Safety and crisis help" intro="You deserve support right now. These services are free and open every day.">
      <ul className="cards">
        <li className="card">
          <h2>In immediate danger</h2>
          <p>
            Call <a href="tel:911">911</a> or your local emergency number.
          </p>
        </li>
        <li className="card">
          <h2>Thinking about hurting yourself</h2>
          <p>
            In the US, call or text <a href="tel:988">988</a>, the Suicide and Crisis Lifeline.
          </p>
        </li>
      </ul>
      <p>
        Rumi is a practice and planning tool. It cannot contact emergency services or anyone else for you, and it is
        not a substitute for professional care.
      </p>
    </Page>
  );
}
