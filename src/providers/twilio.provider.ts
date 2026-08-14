import twilio, { type Twilio } from 'twilio';

import { env, isProduction } from '@config/env';
import { ApiError } from '@utils/api-error';
import { ERROR_CODES } from '@utils/error-codes';
import { logger } from '@utils/logger';

/**
 * Twilio Verify (spec §2). Twilio generates, stores, and checks the code — we
 * never see or persist it, which keeps OTP secrets out of our database entirely.
 *
 * Behind an interface so tests mock this boundary and nothing below it.
 */

export interface OtpSendResult {
  status: string;
}

export interface OtpCheckResult {
  valid: boolean;
  status: string;
}

export interface OtpProvider {
  sendCode(phone: string): Promise<OtpSendResult>;
  checkCode(phone: string, code: string): Promise<OtpCheckResult>;
}

function hasCredentials(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
}

let client: Twilio | null = null;

function getClient(): Twilio {
  if (!client) {
    client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

const twilioProvider: OtpProvider = {
  async sendCode(phone) {
    try {
      const verification = await getClient()
        .verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID!)
        .verifications.create({ to: phone, channel: 'sms' });

      return { status: verification.status };
    } catch (error) {
      logger.error({ err: error }, 'twilio verify send failed');
      throw new ApiError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'We could not send a code right now. Please try again shortly.',
      );
    }
  },

  async checkCode(phone, code) {
    try {
      const check = await getClient()
        .verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID!)
        .verificationChecks.create({ to: phone, code });

      return { valid: check.status === 'approved', status: check.status };
    } catch (error) {
      // Twilio returns 404 for an expired or already-consumed verification.
      // That is a wrong-code outcome, not an outage.
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return { valid: false, status: 'expired' };
      }

      logger.error({ err: error }, 'twilio verify check failed');
      throw new ApiError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'We could not verify that code right now. Please try again shortly.',
      );
    }
  },
};

/**
 * Development stand-in for machines without Twilio credentials.
 *
 * Safe by construction: env validation makes all three Twilio variables
 * mandatory in production, so `hasCredentials()` is always true there and this
 * object can never be selected. It is still guarded on NODE_ENV as a second
 * lock, because an OTP bypass reaching production would be catastrophic.
 */
const DEV_CODE = '000000';

const stubProvider: OtpProvider = {
  async sendCode(phone) {
    logger.warn(
      { phone_suffix: phone.slice(-4) },
      `Twilio is not configured — no SMS sent. Use code ${DEV_CODE} to verify.`,
    );
    return Promise.resolve({ status: 'pending' });
  },

  async checkCode(_phone, code) {
    return Promise.resolve({
      valid: code === DEV_CODE,
      status: code === DEV_CODE ? 'approved' : 'pending',
    });
  },
};

export function getOtpProvider(): OtpProvider {
  if (hasCredentials()) {
    return twilioProvider;
  }

  if (isProduction) {
    // Unreachable: env validation rejects a production boot without these.
    // Kept as a hard stop in case that validation is ever loosened.
    throw new Error('Twilio credentials are required in production');
  }

  return stubProvider;
}

export const DEV_OTP_CODE = DEV_CODE;
