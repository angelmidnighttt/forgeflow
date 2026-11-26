import type { EmailContent } from '../types/mail.types.js';
import { renderEmailLayout } from './email-layout.template.js';

export interface ResetPasswordInput {
  name: string | null;
  /** Link to the web app's reset page, token included. */
  url: string;
  expiresInMinutes: number;
}

export function resetPasswordTemplate(input: ResetPasswordInput): EmailContent {
  return {
    subject: 'Reset your ForgeFlow password',
    ...renderEmailLayout({
      heading: 'Reset your password',
      paragraphs: [
        input.name ? `Hi ${input.name},` : 'Hi,',
        'Someone asked to reset the password of the ForgeFlow account for this email address. Choose a new password with the link below.',
        'Resetting the password signs the account out on every device.',
      ],
      action: { label: 'Choose a new password', url: input.url },
      footnote: `The link works once and expires in ${input.expiresInMinutes} minutes. If you did not ask for this, ignore this email: your password stays the same.`,
    }),
  };
}
