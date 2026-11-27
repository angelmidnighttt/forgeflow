import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxService } from './outbox.service.js';

/** The transactional outbox: enqueueing, dead events for admins. The worker lives in WorkerModule. */
@Module({
  imports: [AuditModule],
  controllers: [OutboxController],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
