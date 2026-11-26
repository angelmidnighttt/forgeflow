import type { EmailContent } from '../types/mail.types.js';
import { renderEmailLayout } from './email-layout.template.js';

export interface PasswordChangedInput {
  name: string | null;
  /** Where to start a password reset if the change was not the account owner. */
  forgotPasswordUrl: string;
}

/** Sent after every password change or reset, so a takeover does not go unnoticed. */
export function passwordChangedTemplate(input: PasswordChangedInput): EmailContent {
  return {
    subject: 'Your ForgeFlow password was changed',
    ...renderEmailLayout({
      heading: 'Your password was changed',
      paragraphs: [
        input.name ? `Hi ${input.name},` : 'Hi,',
        'The password of your ForgeFlow account was just changed, and the account was signed out on its other devices.',
        'If you made this change, there is nothing else to do.',
      ],
      action: { label: 'I did not change it — reset my password', url: input.forgotPasswordUrl },
    }),
  };
}
