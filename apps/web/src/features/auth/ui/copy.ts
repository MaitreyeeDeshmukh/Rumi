import { CODE_LENGTH, MIN_PASSWORD_LENGTH } from "../authController";

/**
 * Every sentence on the log-in, sign-up and forgot-password pages. Plain words, 15 words or fewer
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
    unconfirmedHelp: "Your email is not confirmed yet. You can send a new code.",
  },
  signup: {
    title: "Sign up",
    intro: "Make an account to keep your choices on any device.",
    submit: "Sign up",
    pending: "Signing up",
    toLogin: "Have an account? Log in",
    guestKept: "Your saved choices on this device stay with your new account.",
  },
  code: {
    title: "Enter your code",
    body: (email: string): string => `If ${email} can be used, we sent a ${CODE_LENGTH}-digit code to it.`,
    label: `${CODE_LENGTH}-digit code`,
    hint: "You only need this code once. Later you log in with your password.",
    submit: "Confirm",
    pending: "Checking",
    resend: "Send a new code",
    resending: "Sending",
    resent: "Check your email for a new code.",
    wait: (seconds: number): string => `Send a new code in ${seconds} seconds`,
    wrongEmail: "Wrong email? Go back",
    short: `Enter all ${CODE_LENGTH} digits.`,
  },
  fields: {
    email: "Email",
    password: "Password",
    newPassword: "New password",
    passwordHint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    show: "Show password",
    hide: "Hide password",
  },
  forgot: {
    title: "Forgot password",
    intro: "Enter your email. We will send a code to choose a new password.",
    submit: "Send code",
    pending: "Sending",
    codeIntro: (email: string): string => `If ${email} has an account, we sent a ${CODE_LENGTH}-digit code to it.`,
    codeSubmit: "Save new password",
    codePending: "Saving",
    backToLogin: "Back to log in",
  },
  shared: {
    guestLink: "Continue without an account",
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
