import type { ReactNode } from "react";

/**
 * A phone-shaped frame around a static example. It is hidden from screen readers and inert, so nothing in it
 * can be focused or pressed. The caption sits outside the hidden part, so everyone is told it is made up.
 */
export function DeviceFrame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 w-full max-w-[19rem]">
      <div data-device-frame aria-hidden="true" inert className="rounded-[2rem] border-2 border-line-strong bg-bg p-3">
        {children}
      </div>
      <figcaption className="mt-2 text-sm text-muted-ink">{caption}</figcaption>
    </figure>
  );
}
