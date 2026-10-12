import pino from 'pino';
import { config, isTest } from '../config.js';

/** Removes secrets that can appear in URLs, such as password-reset tokens. */
export const redactUrl = (url: string) => url.replace(/([?&](?:token|reset_token|code)=)[^&#]*/gi, '$1[redacted]');

export const logger = pino({
  level: isTest ? 'silent' : config.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'token'],
});
