import type { ReactNode } from "react";

export function Page({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <article className="page">
      <h1>{title}</h1>
      {intro ? <p className="intro">{intro}</p> : null}
      {children}
    </article>
  );
}
