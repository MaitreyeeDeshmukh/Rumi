// Typed port of DoctorAvatar from prototype/src/health.tsx. Still picture: no animation, so nothing loops.
// While the clinician answers, the ring is thicker and the mouth is open, so the cue is a shape, not motion.
type Variant = "patel" | "alex" | "kim";

const LOOK: Record<Variant, { hair: string; skin: string; hairPath: string }> = {
  patel: {
    hair: "#2B2230",
    skin: "#C9946F",
    hairPath: "M66 92c-4-30 12-46 34-46 24 0 40 16 34 46-4-14-16-26-34-26-16 0-28 10-34 26Z",
  },
  alex: {
    hair: "#6B4A33",
    skin: "#E8BF9C",
    hairPath: "M66 88c0-26 14-40 34-40s34 14 34 40c-6-12-18-20-34-20s-28 8-34 20Z",
  },
  kim: {
    hair: "#3A2C2A",
    skin: "#D9A884",
    hairPath: "M66 92c-4-30 12-46 34-46 24 0 40 16 34 46-4-14-16-26-34-26-16 0-28 10-34 26Z",
  },
};

export function DoctorAvatar({ speaking, variant = "patel", className = "size-28" }: { speaking: boolean; variant?: Variant; className?: string }) {
  const { hair, skin, hairPath } = LOOK[variant];
  return (
    <svg viewBox="0 0 200 200" className={`${className} shrink-0`} aria-hidden="true" data-speaking={speaking ? "true" : "false"}>
      <circle cx="100" cy="100" r="96" fill="#3A3650" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#BBAAE8" strokeWidth={speaking ? 10 : 4} />
      <path d="M38 196c6-38 30-56 62-56s56 18 62 56Z" fill="#F4F2F8" />
      <path d="M84 142l16 22 16-22" fill="#DCEAF4" />
      <path d="M70 150c-4 18 2 30 14 32" stroke="#66558D" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="90" y="118" width="20" height="26" rx="8" fill={skin} />
      <ellipse cx="100" cy="92" rx="32" ry="37" fill={skin} />
      <path d={hairPath} fill={hair} />
      <circle cx="88" cy="94" r="3.4" fill="#2A2733" />
      <circle cx="112" cy="94" r="3.4" fill="#2A2733" />
      <path d="M86 84c3-2 7-2 9 0M105 84c3-2 7-2 9 0" stroke="#2A2733" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="100" cy="112" rx="7" ry={speaking ? 6 : 3} fill="#8A4B45" />
    </svg>
  );
}
