"use client";

import { useEffect, useRef } from "react";

const HIDE_AFTER_MS = 900;
const MIN_THUMB = 32;

/**
 * A thin scroll thumb drawn over the page at the right edge. The native scrollbar is hidden in globals.css, so it
 * takes no width. The thumb shows while the page scrolls, fades out 900 ms after it stops, and a mouse can drag it while
 * it is visible. It only reads scroll events (never prevents them), so wheel, keyboard and touch scrolling are native.
 * All updates go straight to the element through a ref, so nothing here is React state.
 */
export function OverlayScrollbar() {
  const thumb = useRef(null as HTMLDivElement | null);

  useEffect(() => {
    const el = thumb.current;
    if (!el) return;
    const root = document.documentElement;
    let hideTimer = 0;
    let dragging = false;
    let startY = 0;
    let startScroll = 0;

    const range = () => root.scrollHeight - root.clientHeight;
    const thumbHeight = () => Math.max(MIN_THUMB, (root.clientHeight / root.scrollHeight) * root.clientHeight);

    const place = () => {
      const scrollable = range() > 1;
      el.dataset.empty = scrollable ? "false" : "true";
      if (!scrollable) return;
      const h = thumbHeight();
      el.style.height = `${h}px`;
      el.style.transform = `translateY(${(root.scrollTop / range()) * (root.clientHeight - h)}px)`;
    };

    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!dragging) el.dataset.showing = "false";
      }, HIDE_AFTER_MS);
    };

    const reveal = () => {
      place();
      el.dataset.showing = "true";
      scheduleHide();
    };

    const onDown = (e: PointerEvent) => {
      // Touch and pen keep their native scrolling; only a mouse drags the thumb.
      if (e.pointerType !== "mouse") return;
      dragging = true;
      startY = e.clientY;
      startScroll = root.scrollTop;
      el.setPointerCapture(e.pointerId);
      el.dataset.dragging = "true";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const travel = root.clientHeight - thumbHeight();
      if (travel > 0) root.scrollTop = startScroll + ((e.clientY - startY) * range()) / travel;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.dataset.dragging = "false";
      scheduleHide();
    };

    place();
    window.addEventListener("scroll", reveal, { passive: true });
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    observer.observe(root);
    observer.observe(document.body);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("scroll", reveal);
      window.removeEventListener("resize", place);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return <div ref={thumb} className="overlay-scrollbar no-print" data-overlay-scrollbar="" aria-hidden="true" />;
}
