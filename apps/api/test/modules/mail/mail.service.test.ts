import { describe, expect, it } from '@jest/globals';
import type { SendMailOptions } from 'nodemailer';
import type { MailTransport } from '../../../src/common/types/mail.types.js';
import type { ApiEnv } from '../../../src/config/env.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';

const env = { MAIL_FROM: 'ForgeFlow <no-reply@forgeflow.test>' } as ApiEnv;

/** Records what would have been sent and answers with `result`. */
function fakeTransport(result: () => Promise<{ messageId: string }>) {
  const sent: SendMailOptions[] = [];
  const transport: MailTransport = {
    sendMail: (options) => {
      sent.push(options);
      return result();
    },
    close: () => {},
  };
  return { transport, sent };
}

describe('MailService', () => {
  it('sends from MAIL_FROM and returns the Message-ID', async () => {
    const { transport, sent } = fakeTransport(() =>
      Promise.resolve({ messageId: '<abc@forgeflow.test>' }),
    );
    const id = await new MailService(env, transport).send({
      to: 'ann@example.test',
      subject: 'Hello',
      text: 'Plain body',
      html: '<p>HTML body</p>',
    });

    expect(id).toBe('<abc@forgeflow.test>');
    expect(sent).toEqual([
      {
        from: 'ForgeFlow <no-reply@forgeflow.test>',
        to: 'ann@example.test',
        subject: 'Hello',
        text: 'Plain body',
        html: '<p>HTML body</p>',
      },
    ]);
  });

  it('passes a transport failure on to the caller', async () => {
    const failure = new Error('connect ECONNREFUSED');
    const { transport } = fakeTransport(() => Promise.reject(failure));
    await expect(
      new MailService(env, transport).send({ to: 'ann@example.test', subject: 'S', text: 'T' }),
    ).rejects.toBe(failure);
  });
});
