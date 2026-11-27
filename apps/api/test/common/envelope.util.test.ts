import { describe, expect, it } from '@jest/globals';
import type { Keyring } from '../../src/common/types/secrets.types.js';
import { open, rewrap, seal, secretContext } from '../../src/common/utils/envelope.util.js';

const key = (byte: number) => Buffer.alloc(32, byte);
const ring = (current: number, ...versions: number[]): Keyring => ({
  current,
  keys: new Map(versions.map((version) => [version, key(version)])),
});
const context = secretContext({
  organizationId: '00000000-0000-4000-8000-00000000000a',
  integrationId: '00000000-0000-4000-8000-00000000000b',
  name: 'signing_secret',
  version: 1,
});

describe('envelope encryption', () => {
  it('opens what it sealed, and never stores the value or the data key in clear', () => {
    const sealed = seal(ring(1, 1), 's3cr3t-value', context);
    expect(sealed.kekVersion).toBe(1);
    expect(open(ring(1, 1), sealed, context)).toBe('s3cr3t-value');
    expect(sealed.ciphertext.includes(Buffer.from('s3cr3t-value'))).toBe(false);
    // nonce + tag + 32-byte data key
    expect(sealed.wrappedKey.length).toBe(12 + 16 + 32);
  });

  it('uses a fresh data key and nonce every time', () => {
    const a = seal(ring(1, 1), 'same', context);
    const b = seal(ring(1, 1), 'same', context);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
  });

  it('refuses a secret moved to another context (organization, integration, name or version)', () => {
    const sealed = seal(ring(1, 1), 'value', context);
    const elsewhere = [
      secretContext({
        organizationId: '00000000-0000-4000-8000-0000000000ff',
        integrationId: '00000000-0000-4000-8000-00000000000b',
        name: 'signing_secret',
        version: 1,
      }),
      context.replace('signing_secret', 'password'),
      context.replace(/\|1$/, '|2'),
    ];
    for (const other of elsewhere) expect(() => open(ring(1, 1), sealed, other)).toThrow();
  });

  it('refuses an altered ciphertext or wrapped key', () => {
    const sealed = seal(ring(1, 1), 'value', context);
    const flip = (buffer: Buffer, at: number) => {
      const copy = Buffer.from(buffer);
      copy[at] = (copy[at] ?? 0) ^ 0xff;
      return copy;
    };
    expect(() =>
      open(ring(1, 1), { ...sealed, ciphertext: flip(sealed.ciphertext, 30) }, context),
    ).toThrow();
    expect(() =>
      open(ring(1, 1), { ...sealed, wrappedKey: flip(sealed.wrappedKey, 30) }, context),
    ).toThrow();
  });

  it('cannot open a secret whose key is missing from the keyring', () => {
    const sealed = seal(ring(1, 1), 'value', context);
    expect(() => open(ring(2, 2), sealed, context)).toThrow(/Secret key 1 is not configured/);
  });

  it('rewraps the data key under the current key without touching the ciphertext', () => {
    const sealed = seal(ring(1, 1), 'value', context);
    const rotated = rewrap(ring(2, 1, 2), sealed, context);
    expect(rotated.kekVersion).toBe(2);
    expect(rotated.ciphertext.equals(sealed.ciphertext)).toBe(true);
    expect(rotated.wrappedKey.equals(sealed.wrappedKey)).toBe(false);
    // Key 1 can go once everything is rewrapped.
    expect(open(ring(2, 2), rotated, context)).toBe('value');
    // Already current: unchanged.
    expect(rewrap(ring(2, 1, 2), rotated, context)).toBe(rotated);
  });
});
