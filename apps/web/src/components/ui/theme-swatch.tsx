import type { ThemeName } from "@/lib/theme";

/** A small preview painted with one look's own colours (the theme tokens apply to this element only). Decorative. */
export function ThemeSwatch({ theme }: { theme: ThemeName }) {
  return (
    <span
      aria-hidden="true"
      data-app-theme={theme}
      className="mb-1 flex h-9 w-28 items-center gap-1.5 rounded-control border-2 border-line-strong px-2"
      style={{ background: "var(--bg)" }}
    >
      <span className="size-4 rounded-full" style={{ background: "var(--primary)" }} />
      <span className="h-2 w-8 rounded-full" style={{ background: "var(--ink)" }} />
      <span className="h-2 w-5 rounded-full" style={{ background: "var(--primary-soft)" }} />
    </span>
  );
}
