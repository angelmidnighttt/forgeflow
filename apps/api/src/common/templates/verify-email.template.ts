import type { EmailContent } from '../types/mail.types.js';
import { renderEmailLayout } from './email-layout.template.js';

export interface VerifyEmailInput {
  name: string | null;
  /** Link to the web app's verification page, token included. */
  url: string;
  expiresInHours: number;
}

export function verifyEmailTemplate(input: VerifyEmailInput): EmailContent {
  return {
    subject: 'Verify your email for ForgeFlow',
    ...renderEmailLayout({
      heading: 'Verify your email',
      paragraphs: [
        input.name ? `Hi ${input.name},` : 'Hi,',
        'Confirm that this is your email address to finish setting up your ForgeFlow account.',
      ],
      action: { label: 'Verify email', url: input.url },
      footnote: `The link works once and expires in ${input.expiresInHours} hours. If you did not create a ForgeFlow account, ignore this email.`,
    }),
  };
}
