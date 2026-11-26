import type { OAuthProvider } from '@forgeflow/database';

export interface NewUserInput {
  email: string;
  name: string | null;
  /** argon2id hash; null for accounts that only sign in through OAuth. */
  passwordHash: string | null;
  /** Set when the address is already proven, e.g. verified by the OAuth provider. */
  emailVerifiedAt?: Date;
}

export interface NewOAuthAccountInput {
  userId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  providerLogin: string | null;
}
