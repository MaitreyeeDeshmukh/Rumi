import type { ReactNode } from "react";
import { COPY } from "@/components/copy";

/** One screen: h1, lead, content and the AI-helper line. The layouts render BackRow and FocusOnNavigate. */
export function Screen({
  title,
  lead,
  footer = true,
  children,
}: {
  title: string;
  lead: string;
  footer?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="page-enter">
      <h1 tabIndex={-1}>{title}</h1>
      <p className="intro">{lead}</p>
      {children}
      {footer ? <p className="note mt-8">{COPY.notDoctor}</p> : null}
    </div>
  );
}
