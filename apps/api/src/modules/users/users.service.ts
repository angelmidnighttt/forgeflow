import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@forgeflow/contracts';
import { users, type DatabaseHandle, type User } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }
}

/** The user as the API shows it. Never includes the password hash. */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
