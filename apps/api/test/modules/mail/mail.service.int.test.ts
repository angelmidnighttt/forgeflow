import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createApp } from '../../../src/app.factory.js';
import { MailModule } from '../../../src/modules/mail/mail.module.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';
import { envFor } from '../../support/http.js';
import { testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';

describe('MailService over SMTP (Mailpit)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }), { imports: [MailModule] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('delivers a text + HTML email from MAIL_FROM', async () => {
    const to = `mail-${randomUUID()}@example.test`;
    const messageId = await app.get(MailService).send({
      to,
      subject: 'Xác minh email — ForgeFlow',
      text: 'Plain text body',
      html: '<p>HTML <strong>body</strong></p>',
    });

    const received = await waitForEmailTo(to);
    expect(`<${received.MessageID}>`).toBe(messageId);
    expect(received.From).toEqual({ Name: 'ForgeFlow', Address: 'no-reply@forgeflow.test' });
    expect(received.To).toEqual([{ Name: '', Address: to }]);
    expect(received.Subject).toBe('Xác minh email — ForgeFlow');
    expect(received.Text.trim()).toBe('Plain text body');
    expect(received.HTML).toContain('<p>HTML <strong>body</strong></p>');
  });
});

describe('MailService with an unreachable SMTP server', () => {
  it('rejects instead of hanging', async () => {
    const app = await createApp(envFor({ SMTP_URL: 'smtp://127.0.0.1:1' }), {
      imports: [MailModule],
    });
    await app.init();
    try {
      await expect(
        app.get(MailService).send({ to: 'nobody@example.test', subject: 'S', text: 'T' }),
      ).rejects.toThrow(/ECONNREFUSED/);
    } finally {
      await app.close();
    }
  });
});
