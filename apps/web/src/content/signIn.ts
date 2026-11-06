// /sign-in copy. tests/unit/copy.test.ts lints every string.
export const SIGN_IN = {
  title: "Sign up or sign in",
  lead: "Type your email. Rumi sends you a link. There is no password.",
  emailLabel: "Your email",
  emailHint: "If you are new, this makes your account.",
  button: "Email me a link",
  sending: "Sending",
  sent: "Check your email. Open the link on this device.",
  sentLater: "Nothing came? You can ask again in one minute.",
  invalid: "That email address does not look right.",
  linkProblem: "That link did not work. It may be old. Ask for a new one.",
  unavailable: "Sign-in is not working right now. Try again soon.",
  noPassword: "Rumi never asks for a password.",
} as const;
