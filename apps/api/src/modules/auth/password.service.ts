import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, parseOptions, verify, type Algorithm } from '@node-rs/argon2';
import { PASSWORD_HASH_OPTIONS } from '../../common/constants/auth.constants.js';

/** `Algorithm.Argon2id`; the enum is `const`, which isolatedModules cannot read from a .d.ts. */
const ARGON2ID = 2 as Algorithm;

/**
 * Password hashing with argon2id. Hashing runs on libuv's thread pool, not the event loop.
 * Hashes are PHC strings (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`) that carry their own
 * parameters and salt, so the parameters can be raised later without breaking old hashes.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  /** Checked against when the account does not exist, so both cases take the same time. */
  private dummyHash: Promise<string> | undefined;

  /** Makes the dummy hash at startup, so the first unknown-email login is not slower. */
  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  hash(password: string): Promise<string> {
    return hash(password, { ...PASSWORD_HASH_OPTIONS, algorithm: ARGON2ID });
  }

  /**
   * True when `password` matches `passwordHash`. With no hash (unknown email, or an account
   * that only signs in through OAuth) it still does the full amount of work and returns false,
   * so response times do not reveal which emails have accounts.
   */
  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    if (!passwordHash) {
      await verify(await this.getDummyHash(), password).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, password);
    } catch {
      // Not a parseable argon2 hash: treat as a mismatch rather than a server error.
      return false;
    }
  }

  /** True when `passwordHash` was made with parameters other than the current ones. */
  needsRehash(passwordHash: string): boolean {
    try {
      const current = parseOptions(passwordHash);
      return (
        current.algorithm !== ARGON2ID ||
        current.memoryCost !== PASSWORD_HASH_OPTIONS.memoryCost ||
        current.timeCost !== PASSWORD_HASH_OPTIONS.timeCost ||
        current.parallelism !== PASSWORD_HASH_OPTIONS.parallelism ||
        current.outputLen !== PASSWORD_HASH_OPTIONS.outputLen
      );
    } catch {
      return true;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    return this.dummyHash;
  }
}
