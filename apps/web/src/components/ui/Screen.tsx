'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { useCrisis } from '../CrisisProvider';
import { COPY } from '../copy';

/** UX rule 1: h1, one literal sentence, content, footer line. Focus moves to the h1 after navigation. */
export function Screen({ title, lead, children, footer = true, top }: { title: string; lead: string; children: ReactNode; footer?: boolean; top?: ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const { show } = useCrisis();
  useEffect(() => { h1.current?.focus(); }, []);
  return (
    <section className="screen-body">
      {top ? <div className="screen-top">{top}</div> : null}
      <h1 ref={h1} tabIndex={-1}>{title}</h1>
      <p className="lead">{lead}</p>
      {children}
      {footer ? (
        <p className="fineprint">
          <span>{COPY.common.footer}</span>
          <button type="button" className="link" onClick={show}>{COPY.common.urgentHelp}</button>
        </p>
      ) : null}
    </section>
  );
}
