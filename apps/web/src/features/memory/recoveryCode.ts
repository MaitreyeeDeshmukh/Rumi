// 32 symbols, no 0/O/1/I. 20 symbols x 5 bits = 100 bits. 256 is a multiple of 32, so `b & 31` is unbiased.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A new recovery code like ABCDE-FGHJK-LMNPQ-RSTUV. Only the user holds it; it is not an account. */
export function newRecoveryCode(): string {
  const chars = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => ALPHABET[b & 31]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

export const isRecoveryCode = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/.test(s);
