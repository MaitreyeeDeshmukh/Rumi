import css from "./auth.module.css";

/**
 * Every class of the log-in screens, from one CSS module (auth.module.css), so a restyle touches that file only.
 * A plain module is used on purpose: it needs no Tailwind setup and cannot clash with the rest of the app.
 */
export const S = css;
