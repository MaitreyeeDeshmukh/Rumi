import { MIN_PASSWORD_LENGTH } from "../authController";

/**
 * Every sentence on the log-in, sign-up, forgot-password, reset-password and confirm pages. Plain words, 15 words or fewer
 * per sentence, no idioms (checked by tests/unit/authCopy.test.ts with the project's literal lint).
 */
export const AUTH_COPY = {
  login: {
    title: "Log in",
    intro: "Use your email and password to log in.",
    submit: "Log in",
    pending: "Logging in",
    guestWarning: "Logging in to another account leaves this guest's saved choices behind.",
    toSignup: "No account yet? Sign up",
    forgot: "Forgot password?",
    unconfirmedHelp: "Your email is not confirmed yet. You can send the link again.",
  },
  signup: {
    title: "Sign up",
    intro: "Make an account to keep your choices on any device.",
    submit: "Sign up",
    pending: "Signing up",
    toLogin: "Have an account? Log in",
    guestKept: "Your saved choices on this device stay with your new account.",
  },
  checkEmail: {
    title: "Check your email",
    body: (email: string): string => `If ${email} can be used, we sent a link to it.`,
    next: "Open the link to finish making your account.",
    resend: "Send the link again",
    resending: "Sending",
    resent: "Check your email again.",
    backToLogin: "Back to log in",
  },
  fields: {
    email: "Email",
    password: "Password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordHint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    show: "Show password",
    hide: "Hide password",
    mismatch: "The two passwords do not match.",
  },
  forgot: {
    title: "Forgot password",
    intro: "Enter your email. We will send a link to choose a new password.",
    submit: "Send reset link",
    pending: "Sending",
    done: "If that address has an account, we sent a link to reset the password.",
    backToLogin: "Back to log in",
  },
  reset: {
    title: "Choose a new password",
    intro: "Pick a password that is new to you.",
    submit: "Save new password",
    pending: "Saving",
    checking: "Checking your reset link.",
    noSession: "This reset link does not work any more, so ask for a new one.",
    askAgain: "Ask for a new link",
  },
  confirm: {
    title: "Email confirmation",
    checking: "Confirming your email.",
    done: "Email confirmed. You are signed in.",
    failed: "This link did not work. It may be old, or opened on another device.",
    continue: "Continue",
    toLogin: "Log in",
  },
  shared: {
    guestLink: "Continue without an account",
    google: "Continue with Google",
    or: "or",
    errorsLabel: "Problems with this form",
  },
  account: {
    guest: "Guest",
    signedInAs: (email: string): string => `Signed in as ${email}`,
    signOut: "Sign out",
    logIn: "Log in",
    signUp: "Sign up",
  },
} as const;
