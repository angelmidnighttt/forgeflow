import 'reflect-metadata';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
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
  const app = await NestFactory.create(AppModule.forRoot(env, options.imports), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
