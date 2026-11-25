import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { CLOCK, systemClock } from './common/clock.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { resolveRequestId } from './common/request-id.js';
import { API_ENV, type ApiEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { CsrfGuard } from './identity/csrf.guard.js';
import { IdentityModule } from './identity/identity.module.js';
import { SessionGuard } from './identity/session.guard.js';

/** Paths that are polled constantly and would only add noise to the request log. */
const QUIET_PATHS = new Set(['/api/v1/health', '/api/v1/ready']);

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, extraImports: Array<Type | DynamicModule> = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        {
          module: class CoreModule {},
          global: true,
          providers: [
            { provide: API_ENV, useValue: env },
            { provide: CLOCK, useValue: systemClock },
          ],
          exports: [API_ENV, CLOCK],
        },
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: resolveRequestId,
            autoLogging: { ignore: (req) => QUIET_PATHS.has(req.url ?? '') },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-csrf-token"]',
                'req.headers["x-hub-signature-256"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            ...(env.NODE_ENV === 'development'
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
          },
        }),
        DatabaseModule,
        IdentityModule,
        HealthModule,
        ...extraImports,
      ],
      providers: [
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        // Guards run in this order: who is calling, then whether a state change is allowed.
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
