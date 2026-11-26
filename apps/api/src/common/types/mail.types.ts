import type { SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

/** One email to one recipient. `text` is required: some clients and filters only read it. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * The part of a nodemailer SMTP transport the api uses (the promise form of sendMail only).
 * A real transport from createTransport() satisfies it; tests pass a fake.
 */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<Pick<SMTPTransport.SentMessageInfo, 'messageId'>>;
  close(): void;
}
