import { BackButton } from "@/components/nav/BackButton";

/** First element inside every layout's main, directly above the h1. */
export function BackRow() {
  return (
    <div className="back-row no-print">
      <BackButton />
    </div>
  );
}
