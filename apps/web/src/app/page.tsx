import Link from "next/link";
import { COPY } from "@/components/copy";

const m = COPY.marketing;

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>{m.title}</h1>
        <p className="intro">{m.lead}</p>
        <div className="actions">
          <Link className="btn btn-primary" href="/welcome">
            {m.open}
          </Link>
          <Link className="btn btn-secondary" href="/safety">
            {m.safety}
          </Link>
        </div>
      </section>
      <section aria-labelledby="steps">
        <h2 id="steps">{m.stepsTitle}</h2>
        <ol className="home-cards">
          {m.steps.map((s, i) => (
            <li key={s.title} className="home-card">
              <span className="choice-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="note">{m.honesty}</p>
      </section>
    </>
  );
}
