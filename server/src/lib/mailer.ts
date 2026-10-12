import { logger } from './logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Email delivery interface. No email provider is configured, so messages are written
 * to the server log (development) and kept in memory for tests. Plug a real
 * provider in here; nothing else in the app sends mail directly.
 */
export const outbox: Mail[] = [];

export async function sendMail(mail: Mail) {
  outbox.push(mail);
  if (outbox.length > 100) outbox.shift();
  logger.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'mail (log transport)');
}
