const ID = "rumi-announce";

/** Says one short message to screen readers. The region lives on body, so it survives a page change. */
export function announce(text: string): void {
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    el.setAttribute("role", "status");
    el.className = "sr-only";
    document.body.append(el);
  }
  const node = el;
  node.textContent = "";
  window.setTimeout(() => {
    node.textContent = text;
  }, 100);
}
