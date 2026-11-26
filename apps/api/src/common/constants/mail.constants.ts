/**
 * SMTP timeouts. nodemailer's defaults (2 minutes to connect, 10 minutes of socket idle) are
 * meant for batch jobs; email is sent while a request waits, so an unreachable server must fail
 * within seconds.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;
