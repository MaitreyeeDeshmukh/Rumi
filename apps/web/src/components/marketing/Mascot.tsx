/** The Rumi face. Decorative: it always sits next to the product name, so it is hidden from screen readers. */
export function Mascot({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <path
        d="M61 10c23 0 46 15 47 41 1 28-18 55-48 56-30 1-50-22-48-50 2-27 26-47 49-47Z"
        fill="var(--lav-strong)"
      />
      <rect x="44" y="52" width="7" height="11" rx="3.5" fill="var(--mascot-ink)" />
      <rect x="69" y="52" width="7" height="11" rx="3.5" fill="var(--mascot-ink)" />
      <path d="M52 74c4 5 12 5 16 0" stroke="var(--mascot-ink)" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
