import { HOME } from "@/content/dashboard";

// Solid blocks in --line (no shimmer). Seven blocks, the same as a new person's dashboard, with the heights the real
// blocks have (measured at 375, 768 and 1280 px) in rem, so they follow the text size. The steps block is tall under
// 30rem, where the three steps stack. The optional help block only adds length in the middle of the right column.
const block = (h: string) => <div aria-hidden="true" className={`rounded-card bg-line ${h}`} />;

export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {HOME.loading}
      </p>
      <div className="grid items-start gap-5 lg:grid-cols-5">
        <div className="grid gap-5 lg:col-span-3">
          {block("h-[11.9rem] min-[30rem]:h-[10.4rem]")}
          {block("h-[25.4rem] min-[30rem]:h-[10.9rem]")}
          {block("h-[10.1rem]")}
        </div>
        <div className="grid gap-5 lg:col-span-2">
          {block("h-[6.1rem]")}
          {block("h-[10.1rem]")}
          {block("h-[13.3rem]")}
          {block("h-[12.4rem]")}
        </div>
      </div>
    </div>
  );
}
