import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { QUIET_PATHS, REDACTED_LOG_PATHS } from './common/constants/http.constants.js';
import { API_ENV, CLOCK } from './common/constants/injection-tokens.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { OrgPermissionGuard } from './common/guards/org-permission.guard.js';
import { OriginGuard } from './common/guards/origin.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { systemClock } from './common/utils/clock.util.js';
import { resolveRequestId } from './common/utils/request-id.util.js';
import type { ApiEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DeploymentsModule } from './modules/deployments/deployments.module.js';
import { GithubModule } from './modules/github/github.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

/** What the api and the worker share: settings, clock, logger, database. */
export function coreImports(env: ApiEnv): Array<Type | DynamicModule> {
  return [
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
        redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
        ...(env.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
          : {}),
      },
    }),
    DatabaseModule,
  ];
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, extraImports: Array<Type | DynamicModule> = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...coreImports(env),
        RateLimitModule,
        UsersModule,
        AuthModule,
        OrganizationsModule,
        ProjectsModule,
        AuditModule,
        IntegrationsModule,
        OutboxModule,
        WebhooksModule,
        DeploymentsModule,
        GithubModule,
        HealthModule,
        ...extraImports,
      ],
      providers: [
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        // Guards run in this order: who is calling, whether a state change is allowed from
        // where it came, then whether the caller is within the route's rate limits.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        // Last: the caller's role in the organization of the route (@RequirePermission).
        { provide: APP_GUARD, useClass: OrgPermissionGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
