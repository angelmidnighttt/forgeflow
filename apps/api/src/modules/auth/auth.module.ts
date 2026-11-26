import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthMailService } from './auth-mail.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { EmailVerificationService } from './email-verification.service.js';
import { GithubAuthController } from './github-auth.controller.js';
import { GithubOAuthService } from './github-oauth.service.js';
import { GithubSignInService } from './github-sign-in.service.js';
import { OAuthStateCookieService } from './oauth-state-cookie.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordController } from './password.controller.js';
import { PasswordService } from './password.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { SessionsController } from './sessions.controller.js';
import { UserTokenService } from './user-token.service.js';

@Module({
  imports: [UsersModule, MailModule],
  controllers: [
    AuthController,
    EmailVerificationController,
    PasswordController,
    SessionsController,
    GithubAuthController,
  ],
  providers: [
    AccessTokenService,
    RefreshTokenService,
    PasswordService,
    UserTokenService,
    AuthMailService,
    EmailVerificationService,
    PasswordResetService,
    AuthService,
    GithubOAuthService,
    GithubSignInService,
    RefreshCookieService,
    OAuthStateCookieService,
  ],
  exports: [AccessTokenService, AuthService, RefreshCookieService],
})
export class AuthModule {}
