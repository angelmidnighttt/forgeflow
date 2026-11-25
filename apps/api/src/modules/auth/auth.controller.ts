import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ErrorCode,
  loginRequestSchema,
  registerRequestSchema,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
  type TokenResponse,
} from '@forgeflow/contracts';
import type { Request, Response } from 'express';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthContext, IssuedTokens } from '../../common/types/auth.types.js';
import { clientInfoFrom } from '../../common/utils/client-info.util.js';
import { toAuthUser, UsersService } from '../users/users.service.js';
import { AuthService, toTokenResponse } from './auth.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

function signInRequired(): UnauthorizedException {
  return new UnauthorizedException({
    code: ErrorCode.Unauthorized,
    message: 'Sign in to continue.',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshCookieService) private readonly cookie: RefreshCookieService,
  ) {}

  /** Creates an account with email + password and signs it in. */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const outcome = await this.auth.register(body, clientInfoFrom(req));
    if (outcome.status === 'email_taken') {
      throw new ConflictException({
        code: ErrorCode.EmailTaken,
        message: 'An account with this email already exists. Sign in instead.',
      });
    }
    return this.startSignIn(req, res, outcome.tokens);
  }

  /** Signs in with email + password. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const outcome = await this.auth.login(body, clientInfoFrom(req));
    if (outcome.status === 'invalid_credentials') {
      throw new UnauthorizedException({
        code: ErrorCode.InvalidCredentials,
        message: 'Email or password is incorrect.',
      });
    }
    return this.startSignIn(req, res, outcome.tokens);
  }

  /** Exchanges the refresh cookie for a new access token and a replacement refresh cookie. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const secret = this.cookie.read(req);
    if (!secret) throw signInRequired();

    const outcome = await this.auth.refresh(secret, clientInfoFrom(req));
    switch (outcome.status) {
      case 'refreshed':
        this.cookie.set(res, outcome.tokens.refresh);
        return toTokenResponse(outcome.tokens);
      case 'conflict':
        // Another request (usually another tab) refreshed this sign-in a moment ago and its
        // response carried the new cookie; retrying will use it.
        throw new ConflictException({
          code: ErrorCode.Conflict,
          message: 'This sign-in was just refreshed by another request. Retry.',
        });
      case 'invalid':
      case 'reuse_detected':
        this.cookie.clear(res);
        throw signInRequired();
    }
  }

  /** Ends the sign-in on the server and removes the refresh cookie. Works with an expired access token. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const secret = this.cookie.read(req);
    if (secret) await this.auth.signOut(secret);
    this.cookie.clear(res);
  }

  /** The user the access token belongs to. */
  @Get('me')
  async me(@CurrentAuth() auth: AuthContext): Promise<AuthUser> {
    const user = await this.users.findById(auth.userId);
    if (!user) throw signInRequired();
    return toAuthUser(user);
  }

  /**
   * Hands a fresh sign-in to the browser. A sign-in this browser still held is revoked first:
   * its cookie is about to be overwritten, and a family nobody can see should not stay valid.
   */
  private async startSignIn(
    req: Request,
    res: Response,
    tokens: IssuedTokens,
  ): Promise<TokenResponse> {
    const previous = this.cookie.read(req);
    if (previous) await this.auth.signOut(previous);
    this.cookie.set(res, tokens.refresh);
    return toTokenResponse(tokens);
  }
}
