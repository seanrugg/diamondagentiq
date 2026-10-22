import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z
  .object({
    ZETARIS_REST_URL: z.string().url(),
    ZETARIS_ORG_ID: z.string().min(1),
    ZETARIS_AUTH_MODE: z.preprocess((value) => {
      if (typeof value !== "string" || !value.trim()) {
        return "login";
      }
      return value.split("#")[0]?.trim() ?? "login";
    }, z.enum(["login", "apikey"])),
    ZETARIS_BASE_URL: z.preprocess((value) => {
      if (typeof value !== "string" || !value.trim()) {
        return "http://localhost:3000";
      }
      return value.trim();
    }, z.string().url()),
    ZETARIS_USERNAME: optionalString,
    ZETARIS_PASSWORD: optionalString,
    ZETARIS_API_KEY: optionalString,
    LLM_PROVIDER: z
      .string()
      .transform((value) => value.split("#")[0]?.trim() ?? "")
      .pipe(z.enum(["ollama", "meterless"])),
    OLLAMA_BASE_URL: z.string().url(),
    OLLAMA_MODEL: z.string().min(1),
    METERLESS_BASE_URL: z.string().url(),
    METERLESS_RUNTIME_TOKEN: z.string().min(1),
    METERLESS_MODEL: z.string().min(1),
    SAMPLE_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.ZETARIS_AUTH_MODE === "login") {
      if (!env.ZETARIS_USERNAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ZETARIS_USERNAME"],
          message: "Required when ZETARIS_AUTH_MODE=login",
        });
      }
      if (!env.ZETARIS_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ZETARIS_PASSWORD"],
          message: "Required when ZETARIS_AUTH_MODE=login",
        });
      }
    }
    if (env.ZETARIS_AUTH_MODE === "apikey" && !env.ZETARIS_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ZETARIS_API_KEY"],
        message: "Required when ZETARIS_AUTH_MODE=apikey",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues
    .map((issue) => issue.path.join(".") || "(root)")
    .join(", ");
  throw new Error(`Invalid environment configuration: ${fields}`);
}

export const config = parsed.data;
export type AppConfig = typeof config;
