import type { EmailContent } from '../types/mail.types.js';
import { renderEmailLayout } from './email-layout.template.js';

export interface InvitationEmailInput {
  inviterName: string | null;
  inviterEmail: string;
  organizationName: string;
  roleLabel: string;
  /** Link to the web app's invitation page, token included. */
  url: string;
  invitedEmail: string;
  expiresInDays: number;
}

export function invitationTemplate(input: InvitationEmailInput): EmailContent {
  const inviter = input.inviterName ?? input.inviterEmail;
  return {
    subject: `${inviter} invited you to ${input.organizationName} on ForgeFlow`,
    ...renderEmailLayout({
      heading: `Join ${input.organizationName} on ForgeFlow`,
      paragraphs: [
        `${inviter} (${input.inviterEmail}) invited you to join the ${input.organizationName} organization on ForgeFlow as ${input.roleLabel}.`,
        `Sign in or create an account with ${input.invitedEmail} to accept.`,
      ],
      action: { label: 'Accept invitation', url: input.url },
      footnote: `The link works once and expires in ${input.expiresInDays} days. If you did not expect this invitation, ignore this email.`,
    }),
  };
}
