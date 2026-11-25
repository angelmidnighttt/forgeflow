import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type DatabaseHandle } from '@forgeflow/database';
import { API_ENV, type ApiEnv } from '../config/env.js';

/** Injection token for the shared connection pool and Drizzle instance. */
export const DATABASE = Symbol('DATABASE');

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
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
