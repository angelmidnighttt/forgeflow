import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { resolveRequestId } from './common/request-id.js';
import { API_ENV, type ApiEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

/** Paths that are polled constantly and would only add noise to the request log. */
const QUIET_PATHS = new Set(['/api/v1/health', '/api/v1/ready']);

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, extraImports: Array<Type | DynamicModule> = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        {
          module: class EnvModule {},
          global: true,
          providers: [{ provide: API_ENV, useValue: env }],
          exports: [API_ENV],
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
        HealthModule,
        ...extraImports,
      ],
      providers: [
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
