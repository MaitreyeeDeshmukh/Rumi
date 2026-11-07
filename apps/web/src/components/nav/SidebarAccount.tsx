"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCurrentTheme } from "@/components/nav/LookSwitcher";
import { cn } from "@/components/ui/cn";
import { Check, LogOut, Settings, Sun } from "@/components/ui/icons";
import { NAV } from "@/content/nav";
import { PAGES_COPY } from "@/content/pages";
import { useAuth } from "@/features/auth/AuthProvider";
import { AUTH_COPY } from "@/features/auth/ui/copy";
import { useRumi } from "@/lib/rumiActive";
import { THEMES, type ThemeName } from "@/lib/theme";

/** Closes a popup on Escape or a press outside it. Escape returns focus to the button that opened it. */
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      box.current?.querySelector<HTMLElement>("[data-popup-button]")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return box;
}

const popupClass = "absolute bottom-full z-[var(--z-sheet)] mb-2 rounded-card border border-line bg-surface p-1.5 shadow-[var(--shadow)]";
const rowClass = "flex min-h-9 w-full items-center gap-2.5 rounded-control px-3 text-left text-[.95rem] font-bold text-ink no-underline hover:bg-lav";

type PopupProps = {
  label: string;
  className: string;
  button: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
};

function Popup({ label, className, button, children }: PopupProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const box = useDismiss(open, close);
  return (
    <div ref={box} className="relative">
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div role="group" aria-label={label} className={cn(popupClass, className)}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** Bottom of the sidebar: the account (name, email, Settings, sign out) and the look menu, each in its own popup. */
export function SidebarAccount() {
  const auth = useAuth();
  const { update } = useRumi();
  const theme = useCurrentTheme();
  const signedIn = auth.email !== null && !auth.isAnonymous;
  const email = signedIn ? auth.email : null;
  const name = email ? email.split("@")[0] : AUTH_COPY.account.guest;
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-line pt-3">
      <div className="min-w-0 flex-1">
        <Popup
          label={NAV.accountMenu}
          className="left-0 w-[min(16rem,calc(100vw-2rem))]"
          button={({ open, toggle }) => (
            <button
              type="button"
              data-popup-button
              aria-expanded={open}
              onClick={toggle}
              className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-control px-2 text-left hover:bg-lav"
            >
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-ink">
                {initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[.95rem] font-bold text-ink">{name}</span>
                {email ? <span className="block truncate text-xs text-muted-ink">{email}</span> : null}
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b border-line px-3 pb-2">
                <p className="m-0 truncate font-bold text-ink">{name}</p>
                {email ? <p className="m-0 truncate text-sm text-muted-ink">{email}</p> : null}
              </div>
              <Link href="/settings" onClick={close} className={cn(rowClass, "mt-1")}>
                <Settings aria-hidden="true" className="size-4" />
                {PAGES_COPY["/settings"].title}
              </Link>
              {signedIn ? (
                <button type="button" className={rowClass} onClick={() => void auth.signOut().finally(close)}>
                  <LogOut aria-hidden="true" className="size-4" />
                  {AUTH_COPY.account.signOut}
                </button>
              ) : (
                <>
                  <Link href="/login" onClick={close} className={rowClass}>
                    {AUTH_COPY.account.logIn}
                  </Link>
                  <Link href="/signup" onClick={close} className={rowClass}>
                    {AUTH_COPY.account.signUp}
                  </Link>
                </>
              )}
            </>
          )}
        </Popup>
      </div>
      <Popup
        label={NAV.lookMenu}
        className="right-0 w-52"
        button={({ open, toggle }) => (
          <button
            type="button"
            data-popup-button
            aria-expanded={open}
            aria-label={NAV.lookMenu}
            onClick={toggle}
            className="grid size-10 place-items-center rounded-control text-ink hover:bg-lav"
          >
            <Sun aria-hidden="true" className="size-5" />
          </button>
        )}
      >
        {(close) => (
          <div role="radiogroup" aria-label={NAV.look}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={rowClass}
                onClick={() => {
                  update((draft) => {
                    draft.settings.theme = t.id as ThemeName;
                  });
                  close();
                }}
              >
                <span className="grid size-4 place-items-center">{theme === t.id ? <Check aria-hidden="true" className="size-4" /> : null}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </Popup>
    </div>
  );
}
