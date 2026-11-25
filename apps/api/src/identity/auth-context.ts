import type { Session, User } from '@forgeflow/database';
import type { Request } from 'express';

export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'emailVerifiedAt'>;

/** Who is making the request. Present on the request once SessionGuard accepts a session cookie. */
export interface AuthContext {
  user: AuthUser;
  session: Session;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };
