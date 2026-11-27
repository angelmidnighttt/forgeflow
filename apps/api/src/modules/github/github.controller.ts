import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, type GithubApp, type GithubInstallLink } from '@forgeflow/contracts';
import type { Request, Response } from 'express';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import type { RequestWithId } from '../../common/types/http.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { GithubAppService } from './github-app.service.js';
import { GithubInstallationsService } from './github-installations.service.js';

function notConfigured(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'The GitHub App is not configured on this server.',
  });
}

/** Connecting the GitHub App: whether there is one, the link to install it, and its return. */
@Controller()
export class GithubController {
  constructor(
    @Inject(GithubAppService) private readonly github: GithubAppService,
    @Inject(GithubInstallationsService) private readonly installations: GithubInstallationsService,
  ) {}

  /** Whether this server has a GitHub App (the integrations page shows "Connect GitHub"). */
  @Get('github/app')
  app(): GithubApp {
    const app = this.github.app;
    return { configured: app !== undefined, slug: app?.slug ?? null };
  }

  /**
   * The GitHub page that installs the App for this organization. Also sets the cookie that the
   * return to /github/setup must carry (same browser).
   */
  @Post('organizations/:orgId/integrations/github/install')
  @RequirePermission('integrations.manage')
  async install(
    @CurrentMembership() membership: MembershipContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GithubInstallLink> {
    if (!this.github.app) throw notConfigured();
    return { url: await this.installations.installLink(res, membership) };
  }

  /**
   * GitHub's "Setup URL": the browser comes back here after installing, with the installation,
   * the user's authorization code and our state. Redirects to the web app either way.
   */
  @Public()
  @Get('github/setup')
  @RateLimit(RATE_LIMITS.oauthPerIp)
  async setup(
    @Req() req: Request,
    @Res() res: Response,
    @Query('installation_id') installationId: string | undefined,
    @Query('setup_action') setupAction: string | undefined,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
  ): Promise<void> {
    if (!this.github.app) throw notConfigured();
    const requestId = (req as RequestWithId).id;
    const target = await this.installations.completeSetup(
      req,
      res,
      { installationId, setupAction, code, state },
      {
        ipAddress: req.ip ?? null,
        requestId: typeof requestId === 'string' ? requestId : null,
      },
    );
    res.redirect(HttpStatus.FOUND, target.toString());
  }
}
