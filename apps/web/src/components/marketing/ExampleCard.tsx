import { EXAMPLE_CAPTION } from "@/content/home";

export type ExampleRow = { readonly label: string; readonly text: string };

/** A small static example with made-up text. Hidden from screen readers and inert; the caption says it is made up. */
export function ExampleCard({ title, rows }: { title: string; rows: readonly ExampleRow[] }) {
  return (
    <figure className="m-0 w-full max-w-sm">
      <div data-example-card aria-hidden="true" inert className="rounded-card border border-line bg-surface p-4">
        <p className="m-0 mb-2 font-bold text-ink">{title}</p>
        {rows.map((row) => (
          <div key={row.label} className="border-t border-line py-2 first:border-t-0">
            <p className="m-0 text-sm font-bold text-muted-ink">{row.label}</p>
            <p className="m-0 text-ink">{row.text}</p>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-sm text-muted-ink">{EXAMPLE_CAPTION}</figcaption>
    </figure>
  );
}
