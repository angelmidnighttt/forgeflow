import { Body, Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.factory.js';
import { Public } from '../src/common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe.js';
import type { ApiEnv } from '../src/config/env.js';

// The database URL points at a port where nothing listens, so /ready must report "down"
// without the test needing a running PostgreSQL.
const env: ApiEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_VERSION: 'test-1',
  DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
  API_PORT: 0,
  APP_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef',
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'ForgeFlow <no-reply@forgeflow.test>',
};

const echoSchema = z.object({ name: z.string().min(1) });

/** Test-only routes for checking validation and error handling end to end. */
@Public()
@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body(new ZodValidationPipe(echoSchema)) body: z.infer<typeof echoSchema>) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

describe('api HTTP behaviour', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(env, { imports: [TestModule] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns the version in an envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({
      data: { status: 'ok', version: 'test-1', uptimeSeconds: expect.any(Number) },
    });
  });

  it('GET /api/v1/ready returns 503 when the database is unreachable', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/ready').expect(503);
    expect(res.body).toEqual({ data: { status: 'not_ready', checks: { database: 'down' } } });
  });

  it('echoes a safe X-Request-Id and generates one otherwise', async () => {
    const kept = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'abc-123');
    expect(kept.headers['x-request-id']).toBe('abc-123');

    const replaced = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'bad id with spaces');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the error envelope with the request id for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'req-404')
      .expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), requestId: 'req-404' },
    });
  });

  it('rejects an invalid body with VALIDATION_FAILED and the failing fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ name: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([{ path: 'name', message: expect.any(String) }]);
  });

  it('accepts a valid body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/echo')
      .send({ name: 'forge' })
      .expect(201);
    expect(res.body).toEqual({ data: { name: 'forge' } });
  });

  it('hides internal error details behind a generic 500', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/test/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
