import { Module, type DynamicModule } from '@nestjs/common';
import { coreImports } from './app.module.js';
import type { ApiEnv } from './config/env.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { GithubModule } from './modules/github/github.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { OutboxWorkerService } from './modules/outbox/outbox-worker.service.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';

/** The worker process (worker.ts): the outbox loop and the handlers it calls. No HTTP. */
@Module({})
export class WorkerModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [...coreImports(env), AuditModule, IntegrationsModule, OutboxModule, GithubModule],
      providers: [OutboxWorkerService],
    };
  }
}
