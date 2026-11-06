// Overlay scrollbars for the prototype: the native bar is hidden (see .sb-* rules in template.html),
// so it never reserves a strip of space. A thin thumb floats on top of the content, appears while the
// user scrolls, and fades out shortly after they stop. Native scrolling (wheel, touch, keyboard) is untouched.

const SELECTOR = '.viewport, .onb-body, .sheet, .call-log, .share-preview';
const HIDE_AFTER_MS = 900;
const MIN_THUMB = 36;
const INSET = 4; // px from the top, bottom and right edge of the scroller

interface Entry { thumb: HTMLElement; timer: number; host: HTMLElement; dragging: boolean }

export function initOverlayScrollbars(): () => void {
  const entries = new WeakMap<Element, Entry>();

  const ensure = (el: HTMLElement): Entry | null => {
    const existing = entries.get(el);
    if (existing) return existing;
    const host = (el.closest('.app') as HTMLElement | null) ?? el.parentElement;
    if (!host) return null;
    const thumb = document.createElement('div');
    thumb.className = 'sb-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    host.appendChild(thumb);
    const entry: Entry = { thumb, timer: 0, host, dragging: false };
    entries.set(el, entry);

    // Drag the thumb to scroll (only reachable while it is visible).
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      entry.dragging = true;
      thumb.setPointerCapture(e.pointerId);
      window.clearTimeout(entry.timer);
      const startY = e.clientY;
      const startTop = el.scrollTop;
      const move = (ev: PointerEvent) => {
        const ratio = el.scrollHeight / el.clientHeight;
        el.scrollTop = startTop + (ev.clientY - startY) * ratio;
      };
      const up = () => {
        entry.dragging = false;
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        schedule(entry);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
    return entry;
  };

  const schedule = (entry: Entry) => {
    window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => { if (!entry.dragging) entry.thumb.classList.remove('show'); }, HIDE_AFTER_MS);
  };

  const place = (el: HTMLElement, entry: Entry): boolean => {
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 1) { entry.thumb.classList.remove('show'); return false; }
    const r = el.getBoundingClientRect();
    const h = entry.host.getBoundingClientRect();
    const track = el.clientHeight - INSET * 2;
    const size = Math.max(MIN_THUMB, Math.round((el.clientHeight / el.scrollHeight) * track));
    const top = INSET + (el.scrollTop / overflow) * (track - size);
    entry.thumb.style.height = size + 'px';
    entry.thumb.style.top = Math.round(r.top - h.top + top) + 'px';
    entry.thumb.style.left = Math.round(r.right - h.left - INSET - 4) + 'px';
    return true;
  };

  const onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches(SELECTOR)) return;
    const entry = ensure(t);
    if (!entry) return;
    if (place(t, entry)) { entry.thumb.classList.add('show'); schedule(entry); }
  };

  // scroll events do not bubble, so listen in the capture phase on the document.
  document.addEventListener('scroll', onScroll, true);
  return () => {
    document.removeEventListener('scroll', onScroll, true);
    document.querySelectorAll('.sb-thumb').forEach((n) => n.remove());
  };
}
