// Pure navigation logic: no framework, no icons, no copy. Titles come in through a callback.

/** Fixed parent of each route; used by Back when there is no earlier in-app page. */
export const PARENT: Readonly<Record<string, string | null>> = {
  "/": null,
  "/how-it-works": "/",
  "/about": "/",
  "/contact": "/",
  "/help": "/",
  "/safety": "/",
  "/privacy": "/",
  "/accessibility": "/",
  "/welcome": "/",
  "/home": "/",
  "/get-ready": "/home",
  "/practice": "/home",
  "/remember": "/home",
  "/share": "/home",
  "/kit": "/home",
  "/say-it": "/home",
  "/appointments": "/home",
  "/appointments/new": "/appointments",
  "/appointment": "/appointments",
  "/record": "/home",
  "/settings": "/home",
};

const APP_ROUTES: readonly string[] = [
  "/home",
  "/welcome",
  "/get-ready",
  "/practice",
  "/remember",
  "/share",
  "/kit",
  "/say-it",
  "/settings",
  "/appointments",
  "/appointments/new",
  "/appointment",
  "/record",
];

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.includes(pathname);
}

/** Next stack after visiting `pathname`: ignore a repeat, pop when going back, otherwise push. */
export function navStack(stack: readonly string[], pathname: string): string[] {
  if (stack.length === 0) return [pathname];
  const top = stack[stack.length - 1];
  if (top === pathname) return [...stack];
  if (stack.length >= 2 && stack[stack.length - 2] === pathname) return stack.slice(0, -1);
  return [...stack, pathname];
}

/** Where Back goes: the previous in-app page when there is one, else the fixed parent. Null only on "/". */
export function backHref(pathname: string, stack: readonly string[]): string | null {
  if (pathname === "/") return null;
  if (stack.length >= 2 && stack[stack.length - 1] === pathname) {
    const prev = stack[stack.length - 2];
    if (prev !== pathname) return prev;
  }
  return PARENT[pathname] ?? "/";
}

export function backAriaLabel(href: string, titleOf: (href: string) => string | undefined): string {
  const title = titleOf(href);
  return title ? `Back to ${title}` : "Back";
}

// Module-level store. `count` is the number of navigations after the first page of the visit.
export type NavState = { readonly stack: readonly string[]; readonly count: number };

const EMPTY: NavState = { stack: [], count: 0 };
let state: NavState = EMPTY;
const listeners = new Set<() => void>();

export const navStore = {
  getSnapshot: (): NavState => state,
  getServerSnapshot: (): NavState => EMPTY,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  record(pathname: string): void {
    const next = navStack(state.stack, pathname);
    if (next.length === state.stack.length && next.every((p, i) => p === state.stack[i])) return;
    state = { stack: next, count: state.stack.length === 0 ? 0 : state.count + 1 };
    listeners.forEach((l) => l());
  },
};
