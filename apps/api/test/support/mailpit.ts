/** SMTP server the integration tests send through: Mailpit from `npm run db:up`. */
export function testSmtpUrl(): string {
  return process.env.SMTP_URL ?? 'smtp://localhost:1025';
}

function mailpitUrl(): string {
  return process.env.MAILPIT_URL ?? 'http://localhost:8025';
}

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
  Text: string;
  HTML: string;
}

interface SearchResult {
  messages_count: number;
  messages: Array<{ ID: string }>;
}

async function mailpitGet<T>(path: string): Promise<T> {
  const url = new URL(path, mailpitUrl());
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new Error(
      `Integration tests need Mailpit at ${url.origin}. Start it with "npm run db:up".`,
      { cause: error },
    );
  }
  if (!res.ok) throw new Error(`Mailpit ${url.pathname} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Mailpit search for mail to `address`, optionally only with `subject` in the subject line. */
function search(address: string, subject?: string, limit = 1): Promise<SearchResult> {
  const terms = [`to:"${address}"`, ...(subject ? [`subject:"${subject}"`] : [])].join(' ');
  return mailpitGet<SearchResult>(
    `/api/v1/search?query=${encodeURIComponent(terms)}&limit=${limit}`,
  );
}

/** How many emails to `address` (with `subject` in the subject line, if given) Mailpit holds. */
export async function countEmailsTo(address: string, subject?: string): Promise<number> {
  return (await search(address, subject)).messages_count;
}

/**
 * Waits for the newest email to `address` (with `subject` in the subject line, if given) and
 * returns it in full. Each test sends to its own unique address, so tests running in parallel
 * never see each other's mail.
 */
export async function waitForEmailTo(
  address: string,
  options: { subject?: string; count?: number; timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const { subject, count = 1, timeoutMs = 5_000 } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await search(address, subject);
    const id = found.messages[0]?.ID;
    if (id && found.messages_count >= count) {
      return mailpitGet<MailpitMessage>(`/api/v1/message/${id}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Email #${count} to ${address} (${subject ?? 'any subject'}) did not arrive`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The link with a secret in an email (`…#token=<secret>`): the full URL and the secret. */
export function linkIn(message: MailpitMessage): { url: string; token: string } {
  const match = /(https?:\/\/\S+#token=([A-Za-z0-9_-]{43}))/.exec(message.Text);
  if (!match?.[1] || !match[2]) throw new Error(`No link with a token in: ${message.Text}`);
  return { url: match[1], token: match[2] };
}
