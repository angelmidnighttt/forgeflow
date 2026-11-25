export interface NewUserInput {
  email: string;
  name: string | null;
  /** argon2id hash; null for accounts that only sign in through OAuth. */
  passwordHash: string | null;
}
