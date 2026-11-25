import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SessionCookies } from './session-cookies.js';
import { SessionService } from './session.service.js';

/** Owns users and sessions. Other modules use SessionService; none touch these tables directly. */
@Module({
  controllers: [AuthController],
  providers: [SessionService, SessionCookies],
  exports: [SessionService, SessionCookies],
})
export class IdentityModule {}
