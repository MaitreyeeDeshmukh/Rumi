import { Logo } from "@/components/nav/Logo";

/** Logo and Urgent help for the app screens. AppShell hides it from 1024 px, where the sidebar holds both. */
export function AppBar() {
  return (
    <header className="no-print border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-[var(--main-max)] flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 py-2">
        <Logo />
      </div>
    </header>
  );
}
