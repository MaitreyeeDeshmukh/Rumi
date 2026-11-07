/**
 * The calm sky behind the Get ready prompt: clouds that drift and a small bird that flies across.
 * Decorative and CSS-only. It shows only while the prompt is on screen (see .gr in globals.css), stops after a few
 * minutes, and is switched off by Reduce motion and the High Contrast look.
 */
export function Scene() {
  return (
    <div aria-hidden="true" className="gr-decor">
      <span className="gr-cloud gr-cloud-a" />
      <span className="gr-cloud gr-cloud-b" />
      <span className="gr-cloud gr-cloud-c" />
      <svg className="gr-bird" viewBox="0 0 64 40" fill="currentColor">
        <ellipse cx="30" cy="24" rx="17" ry="10" />
        <circle cx="48" cy="17" r="7.5" />
        <path d="M54 16l9 3-9 3z" opacity=".85" />
        <path d="M13 22L1 14l5 12z" />
        <path className="gr-wing" d="M26 22C22 8 30 2 40 4 36 10 36 16 34 24z" opacity=".75" />
        <circle cx="50.5" cy="15.5" r="1.6" fill="var(--surface)" />
      </svg>
    </div>
  );
}
