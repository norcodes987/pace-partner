import { z } from "zod";
import { loadEnv, type Env } from "@pace-partner/shared";

const authEnvSchema = z.object({
  JWT_SECRET: z.string().min(1),
  SINGPASS_CLIENT_ID: z.string().min(1),
  SINGPASS_REDIRECT_URI: z.string().url(),
  SINGPASS_OIDC_CONFIG_URL: z.string().url(),
});

export type AuthEnv = Env & z.infer<typeof authEnvSchema>;

export function loadAuthEnv(source: NodeJS.ProcessEnv = process.env): AuthEnv {
  const shared = loadEnv(source);
  const result = authEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return { ...shared, ...result.data };
}
