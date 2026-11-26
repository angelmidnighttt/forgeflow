import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@forgeflow/contracts';
import {
  oauthAccounts,
  users,
  type DatabaseHandle,
  type DbExecutor,
  type OAuthAccount,
  type OAuthProvider,
  type User,
} from '@forgeflow/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { NewOAuthAccountInput, NewUserInput } from '../../common/types/user.types.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async findById(id: string, db: DbExecutor = this.database.db): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /** Case-insensitive, matching the unique index on lower(email). */
  async findByEmail(email: string, db: DbExecutor = this.database.db): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return user;
  }

  /** The user a provider account is linked to, with the link. */
  async findByOAuthAccount(
    provider: OAuthProvider,
    providerAccountId: string,
  ): Promise<{ user: User; account: OAuthAccount } | undefined> {
    const [row] = await this.database.db
      .select({ user: users, account: oauthAccounts })
      .from(oauthAccounts)
      .innerJoin(users, eq(users.id, oauthAccounts.userId))
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Inserts a user. Returns undefined when the email already has an account; the unique index
   * decides, so two concurrent sign-ups with the same email cannot both succeed.
   */
  async create(input: NewUserInput, db: DbExecutor = this.database.db): Promise<User | undefined> {
    const [user] = await db
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return user;
  }

  /**
   * Links a provider account to a user. False when the user already has an account at that
   * provider, or that provider account is linked to someone else (both are unique).
   */
  async linkOAuthAccount(
    input: NewOAuthAccountInput,
    db: DbExecutor = this.database.db,
  ): Promise<boolean> {
    const linked = await db
      .insert(oauthAccounts)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: oauthAccounts.id });
    return linked.length > 0;
  }

  async updateOAuthLogin(accountId: string, providerLogin: string): Promise<void> {
    await this.database.db
      .update(oauthAccounts)
      .set({ providerLogin })
      .where(eq(oauthAccounts.id, accountId));
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string | null,
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
