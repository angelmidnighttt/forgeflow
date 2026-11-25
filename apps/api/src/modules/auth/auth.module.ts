import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    RefreshTokenService,
    PasswordService,
    AuthService,
    RefreshCookieService,
  ],
  exports: [AccessTokenService, AuthService, RefreshCookieService],
})
export class AuthModule {}
