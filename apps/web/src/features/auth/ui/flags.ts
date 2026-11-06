/**
 * The Google button needs the Google provider turned on in the Supabase dashboard, so it is off unless NEXT_PUBLIC_GOOGLE_AUTH is "1".
 * Written as a literal `process.env.NAME` so Next can put the value into the browser bundle at build time.
 */
export const googleAuthEnabled = (): boolean => process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
