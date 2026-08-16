import { z } from "zod";
import { loadEnv, type Env } from "@pace-partner/shared";

const matchingEnvSchema = z.object({
  JWT_SECRET: z.string().min(1),
});

export type MatchingEnv = Env & z.infer<typeof matchingEnvSchema>;

export function loadMatchingEnv(source: NodeJS.ProcessEnv = process.env): MatchingEnv {
  const shared = loadEnv(source);
  const result = matchingEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return { ...shared, ...result.data };
}
