'use client';
import Link from 'next/link';
import { COPY } from '../copy';
import { useRumi } from '../deps';
import { Icon, Screen } from '../ui';

export function HomeScreen() {
  const { state } = useRumi();
  const c = COPY.home;
  return (
    <Screen title={c.hi(state.settings.name)} lead={c.lead}>
      {state.plan ? <p className="strip"><Icon name="notes" />{c.yourPlan(state.plan.mainConcern)}</p> : null}
      <ul className="home-cards">
        {c.cards.map((card, i) => (
          <li key={card.href}>
            <Link className="home-card" href={card.href}>
              <span className="choice-num" aria-hidden="true">{i + 1}</span>
              <span><strong>{card.title}</strong><span>{card.text}</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="section"><Link href="/say-it" className="link">{c.sayIt}</Link></p>
    </Screen>
  );
}
