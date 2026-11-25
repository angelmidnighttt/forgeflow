import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Health, Readiness } from '@forgeflow/contracts';
import { pingDatabase, type DatabaseHandle } from '@forgeflow/database';
import type { Response } from 'express';
import { API_ENV, DATABASE } from '../../common/constants/injection-tokens.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { ApiEnv } from '../../config/env.js';

@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  /** Liveness: answers as long as the process runs. Used to decide whether to restart it. */
  @Get('health')
  health(): Health {
    return {
      status: 'ok',
      version: this.env.APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /** Readiness: 200 only when dependencies are reachable. Used to decide whether to send traffic. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const databaseUp = await pingDatabase(this.database.pool);
    if (!databaseUp) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: databaseUp ? 'ready' : 'not_ready',
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
