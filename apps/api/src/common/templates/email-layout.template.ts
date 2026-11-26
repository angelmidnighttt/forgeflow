import { escapeHtml } from '../utils/html.util.js';

export interface EmailLayoutInput {
  /** Shown first in the message and as the heading of the HTML version. */
  heading: string;
  /** Body paragraphs, plain text. */
  paragraphs: string[];
  /** The one thing to click. The URL is also printed in full for clients that hide buttons. */
  action?: { label: string; url: string };
  /** Small print under the action (why the email was sent, what to do if unexpected). */
  footnote?: string;
}

/**
 * Renders the shared layout of every ForgeFlow email as text and HTML. All input is treated as
 * plain text and escaped, so user data (a name) can never inject markup.
 */
export function renderEmailLayout(input: EmailLayoutInput): { text: string; html: string } {
  const text = [
    input.heading,
    '',
    ...input.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`, ''] : []),
    ...(input.footnote ? [input.footnote, ''] : []),
    '— ForgeFlow',
  ].join('\n');

  const paragraphs = input.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`)
    .join('\n');
  const action = input.action
    ? `<p style="margin:24px 0">
  <a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 20px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(input.action.label)}</a>
</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">If the button does not work, open this link:<br><a href="${escapeHtml(input.action.url)}" style="color:#374151;word-break:break-all">${escapeHtml(input.action.url)}</a></p>`
    : '';
  const footnote = input.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;color:#6b7280">${escapeHtml(input.footnote)}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
<h1 style="margin:0 0 24px;font-size:20px">${escapeHtml(input.heading)}</h1>
${paragraphs}
${action}
${footnote}
<p style="margin:32px 0 0;font-size:13px;color:#9ca3af">ForgeFlow</p>
</div>
</body>
</html>`;

  return { text, html };
}
