import type { Request, Response } from 'express';

import { isProduction } from '@config/env';
import { requireUser } from '@middleware/authenticate';
import { sendSuccess } from '@utils/response';
import type {
  ChangePasswordBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  SendOtpBody,
  SocialSignInBody,
  VerifyOtpBody,
} from './auth.schema';
import * as authService from './auth.service';
import * as otpService from './otp.service';
import * as socialService from './social.service';
import { issueTokenPair, revokeRefreshToken, rotateRefreshToken } from './token.service';

/**
 * Controllers translate between HTTP and the service layer. No business logic,
 * no database access (spec §0.5).
 */

export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;
  const tokens = await authService.register(body);
  sendSuccess(res, { ...tokens }, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = req.body as LoginBody;
  const tokens = await authService.login(body);
  sendSuccess(res, { ...tokens });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refresh_token: refreshToken } = req.body as RefreshBody;
  const tokens = await rotateRefreshToken(refreshToken);
  sendSuccess(res, { ...tokens });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refresh_token: refreshToken } = req.body as RefreshBody;
  await revokeRefreshToken(refreshToken);

  // Always succeeds. Reporting "that token was not valid" would confirm to a
  // caller which tokens are real.
  sendSuccess(res, { signed_out: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  const token = await authService.requestPasswordReset(email);

  // The response never varies on whether the address is registered, or this
  // endpoint becomes an account-enumeration oracle.
  //
  // Email delivery arrives in Batch 11. Until then the token is returned
  // outside production so the flow is testable end to end; `isProduction`
  // guarantees it can never leak to real users.
  const payload: Record<string, unknown> = {
    message: 'If that address has an account, a reset link is on its way.',
  };

  if (!isProduction && token) {
    payload.reset_token = token;
  }

  sendSuccess(res, payload);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as ResetPasswordBody;
  await authService.resetPassword(token, password);
  sendSuccess(res, { password_reset: true });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as ChangePasswordBody;

  await authService.changePassword(user.id, body.current_password, body.new_password);
  sendSuccess(res, { password_changed: true });
}

export async function sendOtp(req: Request, res: Response): Promise<void> {
  const { phone } = req.body as SendOtpBody;
  await otpService.sendOtp(phone);

  // Identical whether or not the number is registered.
  sendSuccess(res, { sent: true });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const body = req.body as VerifyOtpBody;
  const result = await otpService.verifyOtp(body.phone, body.code, body.display_name);
  const tokens = await issueTokenPair(result.user_id, { deviceId: body.device_id ?? null });

  sendSuccess(res, { ...tokens, is_new_user: result.is_new_user }, result.is_new_user ? 201 : 200);
}

export async function googleSignIn(req: Request, res: Response): Promise<void> {
  const body = req.body as SocialSignInBody;
  const result = await socialService.signInWithGoogle(body.id_token, body.display_name);
  const tokens = await issueTokenPair(result.user_id, { deviceId: body.device_id ?? null });

  sendSuccess(res, { ...tokens, is_new_user: result.is_new_user }, result.is_new_user ? 201 : 200);
}

export async function appleSignIn(req: Request, res: Response): Promise<void> {
  const body = req.body as SocialSignInBody;
  const result = await socialService.signInWithApple(body.id_token, body.display_name);
  const tokens = await issueTokenPair(result.user_id, { deviceId: body.device_id ?? null });

  sendSuccess(res, { ...tokens, is_new_user: result.is_new_user }, result.is_new_user ? 201 : 200);
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await authService.getAuthenticatedUser(user.id);
  sendSuccess(res, { ...profile });
}
