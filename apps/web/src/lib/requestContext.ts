// stub for lane merge: owned by prod-observability. Delete this file at merge.
export const REQUEST_ID_HEADER = "x-request-id";
export const newRequestId = (): string => crypto.randomUUID();
