import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { SignJWT, UnsecuredJWT } from 'jose';
import type { ApiEnv } from '../../../src/config/env.js';
import { AccessTokenService } from '../../../src/modules/auth/access-token.service.js';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  TOKEN_POLICY,
} from '../../../src/common/constants/auth.constants.js';

const SECRET = 'test-only-jwt-secret-0123456789abcdef';
const T0 = new Date('2026-01-01T00:00:00.000Z');

function serviceAt(now: () => Date, secret = SECRET): AccessTokenService {
  const env = { JWT_SECRET: secret } as ApiEnv;
  return new AccessTokenService(env, now);
}

/** Signs a token with the right key but arbitrary claims, to test what verify() rejects. */
function signRaw(claims: { sub?: string; iss?: string; aud?: string; alg?: string }) {
  const iat = Math.floor(T0.getTime() / 1000);
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: claims.alg ?? 'HS256' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + 600)
    .setJti(randomUUID())
    .setIssuer(claims.iss ?? JWT_ISSUER)
    .setAudience(claims.aud ?? JWT_AUDIENCE);
  if (claims.sub !== undefined) jwt = jwt.setSubject(claims.sub);
  return jwt.sign(new TextEncoder().encode(SECRET));
}

describe('AccessTokenService', () => {
  const userId = randomUUID();

  it('signs a token that verifies back to the same user', async () => {
    const service = serviceAt(() => T0);
    const { token, expiresAt } = await service.sign(userId);

    expect(expiresAt).toEqual(new Date(T0.getTime() + TOKEN_POLICY.accessTokenTtlSeconds * 1000));
    await expect(service.verify(token)).resolves.toEqual({
      valid: true,
      auth: { userId, tokenId: expect.any(String), expiresAt },
    });
  });

  it('gives every token a different jti', async () => {
    const service = serviceAt(() => T0);
    const a = await service.verify((await service.sign(userId)).token);
    const b = await service.verify((await service.sign(userId)).token);
    expect(a.valid && b.valid && a.auth.tokenId !== b.auth.tokenId).toBe(true);
  });

  it('reports an expired token as expired, not as invalid', async () => {
    let now = T0;
    const service = serviceAt(() => now);
    const { token } = await service.sign(userId);

    now = new Date(T0.getTime() + (TOKEN_POLICY.accessTokenTtlSeconds - 1) * 1000);
    await expect(service.verify(token)).resolves.toMatchObject({ valid: true });
    now = new Date(T0.getTime() + TOKEN_POLICY.accessTokenTtlSeconds * 1000);
    await expect(service.verify(token)).resolves.toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a token signed with another secret', async () => {
    const other = serviceAt(() => T0, 'another-secret-0123456789abcdefghijkl');
    const { token } = await other.sign(userId);
    await expect(serviceAt(() => T0).verify(token)).resolves.toEqual({
      valid: false,
      reason: 'invalid',
    });
  });

  it('rejects a token whose payload was changed after signing', async () => {
    const service = serviceAt(() => T0);
    const { token } = await service.sign(userId);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: randomUUID(), exp: 9_999_999_999 })).toString(
      'base64url',
    );
    await expect(service.verify(`${header}.${forged}.${signature}`)).resolves.toMatchObject({
      valid: false,
    });
  });

  it('rejects unsigned (alg: none) tokens and other algorithms', async () => {
    const service = serviceAt(() => T0);
    const unsigned = new UnsecuredJWT({ sub: userId })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .encode();
    await expect(service.verify(unsigned)).resolves.toMatchObject({ valid: false });
    await expect(
      service.verify(await signRaw({ sub: userId, alg: 'HS512' })),
    ).resolves.toMatchObject({ valid: false });
  });

  it('rejects tokens meant for another issuer or audience, or without a user id', async () => {
    const service = serviceAt(() => T0);
    for (const token of [
      await signRaw({ sub: userId, iss: 'someone-else' }),
      await signRaw({ sub: userId, aud: 'another-service' }),
      await signRaw({}),
      await signRaw({ sub: 'not-a-uuid' }),
    ]) {
      await expect(service.verify(token)).resolves.toEqual({ valid: false, reason: 'invalid' });
    }
  });

  it('rejects strings that are not JWTs', async () => {
    await expect(serviceAt(() => T0).verify('nope')).resolves.toEqual({
      valid: false,
      reason: 'invalid',
    });
  });
});
