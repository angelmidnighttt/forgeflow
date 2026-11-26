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

/**
 * Waits for the newest email to `address` and returns it in full. Each test sends to its own
 * unique address, so tests running in parallel never see each other's mail.
 */
export async function waitForEmailTo(address: string, timeoutMs = 5_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const query = encodeURIComponent(`to:"${address}"`);
    const found = await mailpitGet<{ messages: Array<{ ID: string }> }>(
      `/api/v1/search?query=${query}&limit=1`,
    );
    const id = found.messages[0]?.ID;
    if (id) return mailpitGet<MailpitMessage>(`/api/v1/message/${id}`);
    if (Date.now() > deadline) throw new Error(`No email to ${address} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
