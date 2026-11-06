"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, type ReactNode } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { UrgentHelpButton } from "@/components/nav/UrgentHelpButton";
import { Button } from "@/components/ui/button";
import { X } from "@/components/ui/icons";
import { NAV } from "@/content/nav";
import { AnimatePresence, LazyMotion, domAnimation, m, useSheetMotion } from "@/lib/motion";

/**
 * Bottom sheet on Radix Dialog. It always offers Urgent help (no opt-out). Pressing it closes the sheet first;
 * the crisis dialog opens from onCloseAutoFocus, after the sheet has unmounted and the page is no longer inert.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
}) {
  const { show } = useCrisis();
  const motion = useSheetMotion();
  const pending = useRef(false);
  const opener = useRef(null as HTMLElement | null);

  const urgent = () => {
    pending.current = true;
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <LazyMotion features={domAnimation}>
        <AnimatePresence>
          {open ? (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <m.div
                  className="fixed inset-0 z-[var(--z-sheet)] bg-[color-mix(in_srgb,var(--ink)_55%,transparent)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motion.transition}
                />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content
                asChild
                forceMount
                aria-describedby={undefined}
                onOpenAutoFocus={() => {
                  opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                }}
                onCloseAutoFocus={(e) => {
                  // Focus always goes back to the element that opened the sheet. Radix's own return can land on body
                  // when the content leaves after an exit animation, so it is done here.
                  e.preventDefault();
                  opener.current?.focus();
                  if (!pending.current) return;
                  pending.current = false;
                  show();
                }}
              >
                <m.div
                  className="fixed inset-x-0 bottom-0 z-[var(--z-sheet)] mx-auto grid max-h-[90dvh] w-full max-w-2xl gap-4 overflow-y-auto rounded-t-card border-2 border-b-0 border-line-strong bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink outline-none"
                  {...motion}
                >
                  <DialogPrimitive.Title className="m-0 pr-12 text-xl leading-tight font-bold">{title}</DialogPrimitive.Title>
                  <DialogPrimitive.Close
                    aria-label={NAV.closeWindow}
                    className="absolute top-2 right-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-control text-ink transition-colors duration-150 hover:bg-lav"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </DialogPrimitive.Close>
                  {children}
                  <div className="grid gap-3 border-t border-line pt-4">
                    <UrgentHelpButton onPress={urgent} />
                    <DialogPrimitive.Close asChild>
                      <Button kind="secondary">{NAV.close}</Button>
                    </DialogPrimitive.Close>
                  </div>
                </m.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </LazyMotion>
    </DialogPrimitive.Root>
  );
}
