import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@forgeflow/contracts';
import { users, type DatabaseHandle, type DbExecutor, type User } from '@forgeflow/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { NewUserInput } from '../../common/types/user.types.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async findById(id: string, db: DbExecutor = this.database.db): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /** Case-insensitive, matching the unique index on lower(email). */
  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return user;
  }

  /**
   * Inserts a user. Returns undefined when the email already has an account; the unique index
   * decides, so two concurrent sign-ups with the same email cannot both succeed.
   */
  async create(input: NewUserInput): Promise<User | undefined> {
    const [user] = await this.database.db
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
      })
      .onConflictDoNothing()
      .returning();
    return user;
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    db: DbExecutor = this.database.db,
  ): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  /** Records that the user proved they receive mail at their address. Keeps an earlier date. */
  async markEmailVerified(userId: string, at: Date, db: DbExecutor = this.database.db) {
    await db
      .update(users)
      .set({ emailVerifiedAt: at })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
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
