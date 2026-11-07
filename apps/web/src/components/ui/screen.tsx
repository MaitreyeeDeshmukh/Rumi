import type { ReactNode } from "react";
import { COPY } from "@/components/copy";

/** One screen: h1, lead, content and the AI-helper line. The layouts render BackRow and FocusOnNavigate. */
export function Screen({
  title,
  lead,
  footer = false,
  aside,
  children,
}: {
  title: string;
  lead: string;
  footer?: boolean;
  /** A coloured panel on the left from 1024 px up. The heading, lead and content sit in a card on the right. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const body = (
    <>
      <h1 tabIndex={-1}>{title}</h1>
      <p className="intro">{lead}</p>
      {children}
      {footer ? <p className="note mt-8">{COPY.notDoctor}</p> : null}
    </>
  );
  if (!aside) return <div className="page-enter">{body}</div>;
  return (
    <div className="auth-card page-enter overflow-hidden rounded-[28px] border border-line bg-surface shadow-[var(--shadow)] lg:grid lg:min-h-[max(40rem,calc(100dvh-11rem))] lg:grid-cols-2">
      <div className="hidden lg:block">
        {aside}
      </div>
      <div className="p-6 text-center sm:p-10 lg:flex lg:flex-col lg:justify-center lg:p-14 xl:px-20 [&_p]:mx-auto">{body}</div>
    </div>
  );
}
