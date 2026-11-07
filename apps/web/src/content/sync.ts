// Fixed sentences the sync routes send back with an error code. The browser never shows them; it reads the code.
export const SYNC_MESSAGE = {
  bad_input: 'I could not read that.',
  too_large: 'That is too long.',
  unauthorized: 'You are not signed in yet. Try again in a moment.',
  forbidden: 'This request was blocked. Reload the page and try again.',
  account_required: 'Sync needs an email account. Sign in with your email.',
  consent_required: 'Sync is off. Turn it on to save.',
  rate_limited: 'That was too many tries. Wait a minute.',
  store_unavailable: 'Saving is paused. Your work is on this device.',
  sync_paused: 'Saving is paused. Your work is on this device.',
  not_found: 'That file is not there.',
} as const;
