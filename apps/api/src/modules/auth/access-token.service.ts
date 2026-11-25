import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { JWT_AUDIENCE, JWT_ISSUER, TOKEN_POLICY } from '../../common/constants/auth.constants.js';
import { API_ENV, CLOCK } from '../../common/constants/injection-tokens.js';
import type { AccessTokenCheck, SignedAccessToken } from '../../common/types/auth.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import type { ApiEnv } from '../../config/env.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signs and verifies access tokens: short-lived HS256 JWTs carrying only the user id.
 * Verification pins the algorithm, issuer and audience, so tokens with `alg: none`, another
 * algorithm or meant for another service are rejected.
 */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    @Inject(CLOCK) private readonly now: Clock,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async sign(userId: string): Promise<SignedAccessToken> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + TOKEN_POLICY.accessTokenTtlSeconds;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<AccessTokenCheck> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        requiredClaims: ['sub', 'iat', 'exp', 'jti'],
        currentDate: this.now(),
      });
      const { sub, jti, exp } = payload;
      if (typeof sub !== 'string' || !UUID_PATTERN.test(sub) || typeof jti !== 'string') {
        return { valid: false, reason: 'invalid' };
      }
      return {
        valid: true,
        auth: { userId: sub, tokenId: jti, expiresAt: new Date((exp ?? 0) * 1000) },
      };
    } catch (error) {
      return { valid: false, reason: error instanceof errors.JWTExpired ? 'expired' : 'invalid' };
    }
  }
}
