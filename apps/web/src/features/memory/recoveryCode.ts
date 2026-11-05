/**
 * The recovery code is the only key to a person's saved sentences. 100 bits, no login, no email.
 * Client-safe: only needs the Web Crypto `crypto` global.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I, so `b & 31` has no bias

export function newRecoveryCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => ALPHABET[b & 31]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

/** Strict canonical form. `$` in JS does not match before a trailing newline, and a test pins that. */
export const isRecoveryCode = (s: string): boolean => /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/.test(s);

/** ASCII-only upper-casing. String.toUpperCase would fold U+017F (long s) and U+FB00 (ff ligature) into valid letters. */
const upperAscii = (s: string): string => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));

/** For typed or pasted input: trims, upper-cases (ASCII only), ignores spaces and dashes. Returns the canonical code or null. */
export function normaliseRecoveryCode(input: string): string | null {
  const flat = upperAscii(input.trim()).replace(/[- ]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{20}$/.test(flat)) return null;
  const code = [0, 5, 10, 15].map((i) => flat.slice(i, i + 5)).join('-');
  return isRecoveryCode(code) ? code : null;
}
