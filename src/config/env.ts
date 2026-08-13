import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env before reading process.env. In test runs the harness (tests/setup.ts)
// has already populated process.env, and dotenv never overwrites existing keys.
loadDotenv();

/**
 * Spec 7 / Batch 0: the process must crash on a missing or invalid required
 * variable rather than boot half-configured.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),

  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => /^rediss?:\/\//.test(value), {
      message: 'REDIS_URL must be a redis:// or rediss:// connection string',
    }),

  // Comma-separated list. "*" allows any origin (development only).
  CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  // Accepted by express.json / express.urlencoded (e.g. "1mb", "512kb").
  JSON_BODY_LIMIT: z.string().min(2).default('1mb'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: Record<string, string[]>;

  constructor(issues: Record<string, string[]>) {
    const summary = Object.entries(issues)
      .map(([key, messages]) => `  - ${key}: ${messages.join('; ')}`)
      .join('\n');
    super(`Invalid environment configuration:\n${summary}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Pure parser, exported so tests can exercise validation without touching the
 * real process environment or resetting the module registry.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_';
      const bucket = issues[key];
      if (bucket) {
        bucket.push(issue.message);
      } else {
        issues[key] = [issue.message];
      }
    }
    throw new EnvValidationError(issues);
  }

  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
