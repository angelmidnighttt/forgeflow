/**
 * The keys that encrypt integration secrets' data keys (KEKs), by version. `current` encrypts
 * new secrets; the others still open older ones until they are rewrapped.
 */
export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

/**
 * A secret value under envelope encryption: the value is encrypted with its own random data key
 * (DEK), and the DEK with a KEK of the keyring. Both are AES-256-GCM, packed as
 * nonce (12 bytes) | auth tag (16 bytes) | ciphertext.
 */
export interface SealedSecret {
  kekVersion: number;
  wrappedKey: Buffer;
  ciphertext: Buffer;
}
