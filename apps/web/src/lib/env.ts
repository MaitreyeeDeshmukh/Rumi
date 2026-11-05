import { z } from "zod";

/**
 * The only module that reads process.env. Everything is optional for now
 * because no integrations are wired yet; make a variable required here when
 * the feature that needs it ships.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TEXT_MODEL: z.string().min(1).optional(),
  CARTESIA_API_KEY: z.string().min(1).optional(),
  CARTESIA_VERSION: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
