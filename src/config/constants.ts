/**
 * Spec 4.1: ship v1 from day one. Additive changes stay in v1; breaking changes
 * would become v2.
 */
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

export const SERVICE_NAME = 'kinvo-api';

/** Spec 4.5: default limit 20, max 100. */
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Spec 4.3: access 30 minutes, refresh 60 days. Consumed from Batch 2. */
export const TOKEN_LIFETIMES = {
  ACCESS_SECONDS: 30 * 60,
  REFRESH_SECONDS: 60 * 24 * 60 * 60,
} as const;

export const REQUEST_ID_HEADER = 'x-request-id';
export const REQUEST_ID_MAX_LENGTH = 128;

/** Spec 4.11: headers the Flutter app always sends. */
export const CLIENT_HEADERS = {
  APP_VERSION: 'x-app-version',
  PLATFORM: 'x-platform',
  DEVICE_ID: 'x-device-id',
} as const;
