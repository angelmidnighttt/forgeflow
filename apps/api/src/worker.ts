import { NestFactory } from '@nestjs/core';
import { EnvValidationError } from '@forgeflow/config';
import { Logger } from 'nestjs-pino';
import { loadApiEnv } from './config/env.js';
import { OutboxWorkerService } from './modules/outbox/outbox-worker.service.js';
import { WorkerModule } from './worker.module.js';

// The worker process: same image and settings as the api, no HTTP. It carries out the outbox
// (webhooks, …) and stops cleanly on SIGTERM, finishing the event in hand.
try {
  const env = loadApiEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.get(OutboxWorkerService).start();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
  } else {
    console.error('Worker failed to start:', error);
  }
  process.exit(1);
}
