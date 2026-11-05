import Link from "next/link";
import { SITE } from "@/lib/site";

const AREAS = [
  { title: "My Health", text: "Prepare for an appointment, practice what you want to say, and keep a summary you can understand." },
  { title: "I Need Help", text: "One calm step at a time when plans change, you feel overwhelmed, or you are not sure what to do." },
  { title: "My Circles", text: "Small, friendly groups and meetups that move at your pace." },
  { title: "My Day", text: "Gentle task support that helps you start, without pressure." },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{SITE.tagline}</p>
        <h1>A calm companion for health visits, surprises and finding your people.</h1>
        <p className="intro">
          Rumi is made for neurodivergent young adults. It works in your phone&apos;s browser, so there is nothing to
          install.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href="/preview/index.html">
            Try the interactive preview
          </a>
          <Link className="btn btn-secondary" href="/safety">
            Safety and crisis help
          </Link>
        </div>
        <p className="note">
          The preview uses sample information only. Replies, bookings and chats in it are simulated on your device.
        </p>
      </section>
      <section aria-labelledby="areas">
        <h2 id="areas">What Rumi helps with</h2>
        <ul className="cards">
          {AREAS.map((a) => (
            <li key={a.title} className="card">
              <h3>{a.title}</h3>
              <p>{a.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
