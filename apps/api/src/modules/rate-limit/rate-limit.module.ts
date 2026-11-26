import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service.js';

/** Global: the RateLimitGuard (registered in AppModule) and any service can use the limiter. */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
