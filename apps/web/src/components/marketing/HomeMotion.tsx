"use client";

import { useEffect } from "react";

const reduced = (): boolean =>
  document.documentElement.getAttribute("data-reduced-motion") === "true" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Home page motion that needs JavaScript: sections slide in once as they scroll into view, and the Rumi
 * drawing looks toward the mouse. Nothing loops. With reduced motion (setting or OS) it does nothing, and
 * without JavaScript every section is simply shown.
 */
export function HomeMotion() {
  useEffect(() => {
    if (reduced()) return;
    const root = document.documentElement;
    if (!("IntersectionObserver" in window)) return;
    // Only parts still below the fold wait for a reveal, so nothing already on screen blinks out and back.
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".reveal")).filter(
      (t) => t.getBoundingClientRect().top > window.innerHeight * 0.92,
    );
    targets.forEach((t) => t.classList.add("is-wait"));
    root.setAttribute("data-reveal", "on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );
    targets.forEach((t) => io.observe(t));

    let frame = 0;
    const onPointer = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse" || reduced()) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = ev.clientX / window.innerWidth - 0.5;
        const y = ev.clientY / window.innerHeight - 0.5;
        root.style.setProperty("--ex", `${(x * 6).toFixed(2)}px`);
        root.style.setProperty("--ey", `${(y * 5).toFixed(2)}px`);
      });
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      cancelAnimationFrame(frame);
      root.removeAttribute("data-reveal");
      for (const p of ["--ex", "--ey"]) root.style.removeProperty(p);
    };
  }, []);

  return null;
}
