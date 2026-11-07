import { HOME } from "@/content/dashboard";

// Solid blocks in --line (no shimmer). Three blocks, the same rows as a new person's dashboard: the next step with
// Appointments, the three steps with what sits under them, and Privacy with Quick links. Heights are in rem so they
// follow the text size. Measured at 375 px (everything stacked) and at 1280 px or wider (sidebar and three columns).
const block = (h: string) => <div aria-hidden="true" className={`rounded-card bg-line ${h}`} />;

export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {HOME.loading}
      </p>
      <div className="grid gap-6">
        {block("h-[29.6rem] lg:h-[16.3rem]")}
        {block("h-[62.9rem] md:h-[21.9rem]")}
        {block("h-[29.9rem] lg:h-[15.3rem]")}
      </div>
    </div>
  );
}
