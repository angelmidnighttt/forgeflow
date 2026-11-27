import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring, SealedSecret } from '../types/secrets.types.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ENTRY = /^(\d{1,6}):([A-Za-z0-9+/]+={0,2})$/;

/**
 * Parses SECRET_ENCRYPTION_KEYS: `<version>:<base64 of 32 bytes>`, comma-separated. Returns the
 * keyring, or what is wrong with the value.
 */
export function parseKeyring(value: string): Keyring | string {
  const keys = new Map<number, Buffer>();
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const match = KEY_ENTRY.exec(entry);
    if (!match?.[1] || !match[2]) return 'each key must be "<version>:<base64 of 32 bytes>"';
    const version = Number(match[1]);
    const key = Buffer.from(match[2], 'base64');
    if (version < 1) return 'key versions start at 1';
    if (key.length !== KEY_BYTES) return `key ${version} is ${key.length} bytes; it must be 32`;
    if (keys.has(version)) return `key ${version} is listed twice`;
    keys.set(version, key);
  }
  if (keys.size === 0) return 'list at least one key';
  return { current: Math.max(...keys.keys()), keys };
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

/** Throws when `sealed` was not made with `key` and `aad`, or was altered. */
function decrypt(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, sealed.subarray(0, NONCE_BYTES));
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(sealed.subarray(NONCE_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

function keyOf(keyring: Keyring, version: number): Buffer {
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Secret key ${version} is not configured (SECRET_ENCRYPTION_KEYS)`);
  }
  return key;
}

/**
 * Encrypts `plaintext` under a new data key wrapped by the current KEK. `context` names where the
 * secret belongs (secretContext()); it is authenticated, not stored, so a ciphertext copied
 * to another place does not open there.
 */
export function seal(keyring: Keyring, plaintext: string, context: string): SealedSecret {
  const aad = Buffer.from(context, 'utf8');
  const dataKey = randomBytes(KEY_BYTES);
  try {
    return {
      kekVersion: keyring.current,
      wrappedKey: encrypt(keyOf(keyring, keyring.current), dataKey, aad),
      ciphertext: encrypt(dataKey, Buffer.from(plaintext, 'utf8'), aad),
    };
  } finally {
    dataKey.fill(0);
  }
}

/** Decrypts a sealed secret; throws if it was altered or belongs to another context. */
export function open(keyring: Keyring, sealed: SealedSecret, context: string): string {
  const aad = Buffer.from(context, 'utf8');
  const dataKey = decrypt(keyOf(keyring, sealed.kekVersion), sealed.wrappedKey, aad);
  try {
    return decrypt(dataKey, sealed.ciphertext, aad).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/**
 * The same secret with its data key wrapped by the current KEK (KEK rotation). The ciphertext
 * does not change. Returns `sealed` itself when it already uses the current KEK.
 */
export function rewrap(keyring: Keyring, sealed: SealedSecret, context: string): SealedSecret {
  if (sealed.kekVersion === keyring.current) return sealed;
  const aad = Buffer.from(context, 'utf8');
  const dataKey = decrypt(keyOf(keyring, sealed.kekVersion), sealed.wrappedKey, aad);
  try {
    return {
      kekVersion: keyring.current,
      wrappedKey: encrypt(keyOf(keyring, keyring.current), dataKey, aad),
      ciphertext: sealed.ciphertext,
    };
  } finally {
    dataKey.fill(0);
  }
}

/** The authenticated context of one version of an integration's secret. */
export function secretContext(secret: {
  organizationId: string;
  integrationId: string;
  name: string;
  version: number;
}): string {
  return [
    'forgeflow/integration-secret/v1',
    secret.organizationId,
    secret.integrationId,
    secret.name,
    String(secret.version),
  ].join('|');
}
