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

  // --- Auth (Batch 2) ------------------------------------------------------
  // No defaults, ever. A signing secret with a fallback value is not a secret,
  // and a deployment that silently boots with a known key is forgeable.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).default('kinvo'),

  /// spec §7 Batch 2: password reset tokens are single-use with a one-hour expiry.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),

  // --- External identity providers ----------------------------------------
  // Optional so development and tests boot without third-party credentials;
  // required in production by the refinement below.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

  // Comma-separated: iOS, Android, and web client IDs are all valid audiences.
  GOOGLE_OAUTH_CLIENT_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),

  // Comma-separated Apple bundle identifiers / service IDs.
  APPLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
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
/**
 * Credentials that development and test may omit but production may not.
 * Booting production without them would mean OTP and social sign-in failing at
 * the first real request instead of at deploy time.
 */
const PRODUCTION_REQUIRED: { key: keyof Env; message: string }[] = [
  { key: 'TWILIO_ACCOUNT_SID', message: 'required in production for OTP delivery' },
  { key: 'TWILIO_AUTH_TOKEN', message: 'required in production for OTP delivery' },
  { key: 'TWILIO_VERIFY_SERVICE_SID', message: 'required in production for OTP delivery' },
  { key: 'GOOGLE_OAUTH_CLIENT_IDS', message: 'required in production for Google sign-in' },
  { key: 'APPLE_CLIENT_IDS', message: 'required in production for Apple sign-in' },
];

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

  if (result.data.NODE_ENV === 'production') {
    const missing: Record<string, string[]> = {};

    for (const { key, message } of PRODUCTION_REQUIRED) {
      const value = result.data[key];
      const isEmpty = value === undefined || (Array.isArray(value) ? value.length === 0 : false);
      if (isEmpty) {
        missing[key] = [message];
      }
    }

    if (Object.keys(missing).length > 0) {
      throw new EnvValidationError(missing);
    }
  }

  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
