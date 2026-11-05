// stub for lane merge: owned by prod-observability (frozen signatures, addendum section 3). Delete this file at merge.
export const REQUEST_ID_HEADER = 'x-request-id';
export const newRequestId = (): string => crypto.randomUUID();
