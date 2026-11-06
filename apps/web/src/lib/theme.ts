export type ThemeName = "soft" | "contrast" | "low";

export const THEMES: readonly { id: ThemeName; label: string }[] = [
  { id: "soft", label: "Soft Focus" },
  { id: "contrast", label: "High Contrast" },
  { id: "low", label: "Low Light" },
];

export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-app-theme", name);
}

/**
 * Runs before first paint. Reads only localStorage["rumi.v1"].settings (theme, textScale, reducedMotion).
 * Falls back to Low Light when the OS is dark, else Soft Focus. Everything is inside try/catch.
 * Inline text, no innerHTML: app/layout.tsx puts it in a plain script tag in the head.
 */
export const THEME_INIT_SCRIPT = `try{
var h=document.documentElement,s={};
try{var d=JSON.parse(localStorage.getItem("rumi.v1")||"{}");if(d&&d.version===1&&d.settings)s=d.settings}catch(e){}
var t=s.theme;
if(t!=="soft"&&t!=="contrast"&&t!=="low")t=matchMedia("(prefers-color-scheme: dark)").matches?"low":"soft";
h.setAttribute("data-app-theme",t);
var x=Number(s.textScale);
h.style.setProperty("--scale",String(x===1.15||x===1.3||x===1.5?x:1));
h.setAttribute("data-reduced-motion",String(s.reducedMotion===true||matchMedia("(prefers-reduced-motion: reduce)").matches));
}catch(e){}`;
