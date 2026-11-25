import { describe, expect, it } from '@jest/globals';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PasswordService } from '../../../src/modules/auth/password.service.js';

const passwords = new PasswordService();
const PASSWORD = 'correct horse battery staple';

describe('PasswordService', () => {
  it('hashes with argon2id and the configured parameters, with a fresh salt each time', async () => {
    const first = await passwords.hash(PASSWORD);
    const second = await passwords.hash(PASSWORD);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(PASSWORD);
  });

  it('verifies the right password and rejects others', async () => {
    const stored = await passwords.hash(PASSWORD);
    await expect(passwords.verify(stored, PASSWORD)).resolves.toBe(true);
    await expect(passwords.verify(stored, `${PASSWORD} `)).resolves.toBe(false);
    await expect(passwords.verify(stored, PASSWORD.toUpperCase())).resolves.toBe(false);
  });

  it('returns false without a hash or with a hash it cannot read', async () => {
    await expect(passwords.verify(null, PASSWORD)).resolves.toBe(false);
    await expect(passwords.verify(undefined, PASSWORD)).resolves.toBe(false);
    await expect(passwords.verify('not-a-hash', PASSWORD)).resolves.toBe(false);
  });

  it('asks for a rehash only when the parameters differ from the current ones', async () => {
    expect(passwords.needsRehash(await passwords.hash(PASSWORD))).toBe(false);
    expect(
      passwords.needsRehash(await argon2Hash(PASSWORD, { memoryCost: 4096, timeCost: 1 })),
    ).toBe(true);
    expect(passwords.needsRehash('not-a-hash')).toBe(true);
  });
});
