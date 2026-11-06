import { useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";

// Only these three come from motion. Sheets and list changes use them; nothing else animates with JavaScript.
export { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";

export type MotionProps = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
};

const NONE: MotionProps = { initial: {}, animate: {}, exit: {}, transition: { duration: 0 } };

/** True when the OS asks for less motion or the Reduce motion setting is on. */
function useReduced(): boolean {
  const os = useReducedMotion();
  return Boolean(os) || (typeof document !== "undefined" && document.documentElement.dataset.reducedMotion === "true");
}

/** Sheet and dialog: slide up 16 px and fade in over 250 ms; leave over 150 ms. */
export function useSheetMotion(): MotionProps {
  const reduced = useReduced();
  if (reduced) return NONE;
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 16, transition: { duration: 0.15 } },
    transition: { duration: 0.25, ease: [0.2, 0.7, 0.2, 1] },
  };
}

/** List add and remove: height and opacity over 200 ms. */
export function useListMotion(): MotionProps {
  const reduced = useReduced();
  if (reduced) return NONE;
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: 0.2 },
  };
}
