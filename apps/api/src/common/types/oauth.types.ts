import type { IssuedTokens } from './auth.types.js';

/** What ForgeFlow takes from a GitHub account. */
export interface GithubProfile {
  /** GitHub's numeric user id, as a string: stable even when the username or email changes. */
  id: string;
  login: string;
  name: string | null;
  /** The primary email if GitHub has verified it; null otherwise. */
  verifiedEmail: string | null;
}

/** Kept in the OAuth state cookie between the redirect to GitHub and the callback. */
export interface OAuthState {
  state: string;
  codeVerifier: string;
}

export type GithubSignInOutcome =
  | { status: 'signed_in'; tokens: IssuedTokens }
  /** The ForgeFlow account with this email is linked to another GitHub account. */
  | { status: 'account_conflict' };
