import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { API_ENV, MAIL_TRANSPORT } from '../../common/constants/injection-tokens.js';
import { SMTP_TIMEOUTS } from '../../common/constants/mail.constants.js';
import type { MailTransport } from '../../common/types/mail.types.js';
import type { ApiEnv } from '../../config/env.js';
import { MailService } from './mail.service.js';

@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [API_ENV],
      // Connects lazily, on the first email, so the api starts even when SMTP is down.
      useFactory: (env: ApiEnv): MailTransport =>
        createTransport({ url: env.SMTP_URL, ...SMTP_TIMEOUTS }),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule implements OnApplicationShutdown {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
