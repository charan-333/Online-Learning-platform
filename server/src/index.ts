import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

const app = createApp();
// In production the API also serves the built web app.
const webDist = path.resolve(process.env.WEB_DIST ?? '../web/dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}
app.listen(config.PORT, () => logger.info(`CAT 100 API listening on :${config.PORT}`));
