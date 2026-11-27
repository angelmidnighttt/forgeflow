import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createDatabase,
  roleBypassesRowLevelSecurity,
  type DatabaseHandle,
} from '@forgeflow/database';
import { API_ENV, DATABASE } from '../common/constants/injection-tokens.js';
import type { ApiEnv } from '../config/env.js';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DatabaseHandle => {
        const logger = new Logger('Database');
        return createDatabase(env.DATABASE_URL, {
          applicationName: 'forgeflow-api',
          onIdleClientError: (error) =>
            logger.warn({ err: error }, 'Idle database connection failed; it will be replaced'),
        });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /**
   * Refuses to start when DATABASE_URL connects as a role that bypasses row-level security
   * (superuser or BYPASSRLS): every tenant policy would silently stop applying. If the database
   * cannot be reached yet, the api still starts (readiness reports it) and the check is skipped.
   */
  async onApplicationBootstrap(): Promise<void> {
    let bypasses: boolean;
    try {
      bypasses = await roleBypassesRowLevelSecurity(this.database.pool);
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Could not check the database role; is the database reachable?',
      );
      return;
    }
    if (bypasses) {
      throw new Error(
        'DATABASE_URL connects as a role that bypasses row-level security (a superuser or a role with BYPASSRLS). ' +
          'The api must connect as forgeflow_app; the owner role belongs in MIGRATION_DATABASE_URL (docs/adr/ADR-0002).',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
