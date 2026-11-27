import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ErrorCode,
  IDEMPOTENCY_KEY_PATTERN,
  reportDeploymentRequestSchema,
  updateReportedDeploymentRequestSchema,
  type Deployment,
  type ReportDeploymentRequest,
  type UpdateReportedDeploymentRequest,
} from '@forgeflow/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { CurrentApiToken } from '../../common/decorators/current-api-token.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ApiTokenGuard } from '../../common/guards/api-token.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { ApiTokenContext } from '../../common/types/api-token.types.js';
import { ReportsService } from './reports.service.js';

/**
 * The report API, for pipelines: a project API token instead of a user (Public skips the
 * user's access token; ApiTokenGuard checks the project's). Server-to-server: no Origin, so the
 * CSRF guard lets it through.
 */
@Public()
@RateLimit(RATE_LIMITS.reportPerIp)
@UseGuards(ApiTokenGuard)
@Controller('deployments')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /**
   * Reports a deployment of the token's project. 201 the first time; 200 with the same
   * deployment when the same request comes again with its Idempotency-Key; 422 when the key was
   * used for another request.
   */
  @Post()
  async create(
    @CurrentApiToken() token: ApiTokenContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(reportDeploymentRequestSchema)) body: ReportDeploymentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Deployment> {
    if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message:
          'Send an Idempotency-Key header (up to 200 of A-Z a-z 0-9 . _ : -), the same on retries.',
      });
    }
    const outcome = await this.reports.report(token, key, body);
    if (outcome.status === 'key_reused') {
      throw new UnprocessableEntityException({
        code: ErrorCode.IdempotencyKeyReused,
        message: 'This Idempotency-Key was already used for a different deployment.',
      });
    }
    res.status(outcome.status === 'created' ? 201 : 200);
    return outcome.deployment;
  }

  /** A later status of a deployment the project reported (in_progress → success…). */
  @Patch(':deploymentId')
  async update(
    @CurrentApiToken() token: ApiTokenContext,
    @Param('deploymentId', new ZodValidationPipe(z.uuid())) deploymentId: string,
    @Body(new ZodValidationPipe(updateReportedDeploymentRequestSchema))
    body: UpdateReportedDeploymentRequest,
  ): Promise<Deployment> {
    const deployment = await this.reports.update(token, deploymentId, body);
    if (!deployment) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'No deployment of this project reported with that id.',
      });
    }
    return deployment;
  }
}
