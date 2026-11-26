import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV, MAIL_TRANSPORT } from '../../common/constants/injection-tokens.js';
import type { MailTransport, OutgoingEmail } from '../../common/types/mail.types.js';
import type { ApiEnv } from '../../config/env.js';

/**
 * Sends transactional email over SMTP. Sending happens while the caller waits and a failure is
 * thrown to the caller, who decides whether it matters (a retrying outbox comes with the
 * workflow engine in Phase 5).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  /** Sends `email` and returns the Message-ID the server accepted it under. */
  async send(email: OutgoingEmail): Promise<string> {
    const info = await this.transport.sendMail({
      from: this.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    // The recipient is personal data, so only the Message-ID goes into the log.
    this.logger.log({ messageId: info.messageId }, 'Email sent');
    return info.messageId;
  }
}
