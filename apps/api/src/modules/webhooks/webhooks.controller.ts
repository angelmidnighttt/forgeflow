import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';
import type { Request } from 'express';
import { API_ENV } from '../../common/constants/injection-tokens.js';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { isValidGithubSignature } from '../../common/utils/webhook-signature.util.js';
import type { ApiEnv } from '../../config/env.js';
import { WebhooksService } from './webhooks.service.js';

const DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/;
const EVENT_NAME = /^[a-z_]{1,64}$/;

/** What a webhook sender gets back: its delivery's id here, and whether it was seen before. */
interface WebhookReceipt {
  id: string;
  duplicate: boolean;
}

/**
 * Webhooks from outside systems. A delivery is verified, recorded with its outbox event in one
 * transaction and answered at once; the work happens in the worker. Public: the signature is
 * the authentication.
 */
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  /** The GitHub App's webhook (X-Hub-Signature-256 under GITHUB_APP_WEBHOOK_SECRET). */
  @Post('github')
  @RateLimit(RATE_LIMITS.webhookPerIp)
  @HttpCode(HttpStatus.ACCEPTED)
  async github(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ): Promise<WebhookReceipt> {
    const secret = this.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'The GitHub App is not configured on this server.',
      });
    }
    if (!req.rawBody || !isValidGithubSignature(secret, req.rawBody, signature)) {
      throw new UnauthorizedException({
        code: ErrorCode.InvalidSignature,
        message: 'The webhook signature does not match its body.',
      });
    }
    const body: unknown = req.body;
    if (
      !deliveryId ||
      !DELIVERY_ID.test(deliveryId) ||
      !event ||
      !EVENT_NAME.test(event) ||
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Expected a JSON object with X-GitHub-Delivery and X-GitHub-Event headers.',
      });
    }
    const payload = body as Record<string, unknown>;
    const installation = payload.installation as { id?: unknown } | undefined;
    const recorded = await this.webhooks.record({
      provider: 'github',
      deliveryId,
      event,
      action: typeof payload.action === 'string' ? payload.action : null,
      installationId: typeof installation?.id === 'number' ? String(installation.id) : null,
      payload,
    });
    return { id: recorded.id, duplicate: !recorded.created };
  }
}
