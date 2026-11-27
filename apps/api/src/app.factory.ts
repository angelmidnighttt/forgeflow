import 'reflect-metadata';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { API_PREFIX } from './common/constants/http.constants.js';
import type { ApiEnv } from './config/env.js';

export interface CreateAppOptions {
  /** Extra modules mounted next to the app's own (tests use this for test-only routes). */
  imports?: Array<Type | DynamicModule>;
}

/** Builds the configured Nest application. Shared by main.ts and the HTTP tests. */
export async function createApp(
  env: ApiEnv,
  options: CreateAppOptions = {},
): Promise<INestApplication> {
  // rawBody: webhook signatures are checked against the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(env, options.imports),
    { bufferLogs: true, rawBody: true },
  );
  // GitHub webhook payloads go beyond the default 100 kB.
  app.useBodyParser('json', { limit: '2mb' });
  app.useLogger(app.get(Logger));
  // Without it, X-Forwarded-For is ignored and req.ip is the address of the TCP peer.
  if (env.TRUST_PROXY !== undefined) app.set('trust proxy', env.TRUST_PROXY);
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
