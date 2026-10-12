import pino from 'pino';
import { config, isTest } from '../config.js';

export const logger = pino({
  level: isTest ? 'silent' : config.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'token'],
});
