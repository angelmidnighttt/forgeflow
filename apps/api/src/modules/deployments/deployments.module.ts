import { Module } from '@nestjs/common';
import { ApiTokenGuard } from '../../common/guards/api-token.guard.js';
import { AuditModule } from '../audit/audit.module.js';
import { ApiTokensController } from './api-tokens.controller.js';
import { ApiTokensService } from './api-tokens.service.js';
import { DeploymentsController } from './deployments.controller.js';
import { DeploymentsService } from './deployments.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Deployments of projects: listing, the report API for pipelines, and its API tokens. */
@Module({
  imports: [AuditModule],
  controllers: [DeploymentsController, ReportsController, ApiTokensController],
  providers: [DeploymentsService, ReportsService, ApiTokensService, ApiTokenGuard],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
