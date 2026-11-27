import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { IntegrationSecretsService } from './integration-secrets.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';

/**
 * Integrations and their encrypted secrets, under /organizations/:orgId/integrations. The flows
 * that connect an integration (GitHub, Alertmanager…) use IntegrationsService to create it and
 * IntegrationSecretsService.reveal() to read a secret when talking to the other system.
 */
@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationSecretsService],
  exports: [IntegrationsService, IntegrationSecretsService],
})
export class IntegrationsModule {}
