#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');
const express = require('./_runtime/express.cjs');

function parseArgs(args) {
  const options = { host: '127.0.0.1', port: 4173, open: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') options.host = args[++index];
    else if (arg === '--port') options.port = Number(args[++index]);
    else if (arg === '--open') options.open = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port 必须是 0-65535 的整数');
  }
  return options;
}

function displayHost(host) {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function maybeOpen(url) {
  let command;
  if (process.platform === 'darwin') command = ['open', [url]];
  else if (process.platform === 'win32') command = ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) command = ['xdg-open', [url]];
  if (command) execFile(command[0], command[1], () => {});
}

function startServer(options = {}, onListen) {
  const host = options.host || '127.0.0.1';
  const port = Number.isInteger(options.port) ? options.port : 4173;
  const publicDir = path.join(__dirname, 'public');
  const token = crypto.randomBytes(18).toString('hex');
  const mount = `/preview/${token}`;
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self' data: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; frame-src 'self'; object-src 'none'; base-uri 'none'",
    });
    next();
  });
  app.get('/healthz', (request, response) => response.json({ status: 'ok' }));
  app.get('/', (request, response) => response.redirect(302, `${mount}/`));
  app.use(mount, express.static(publicDir, { dotfiles: 'deny', index: 'index.html', fallthrough: false }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(error.status || 404).type('text').send('Not found');
  });

  const server = app.listen(port, host, () => {
    const address = server.address();
    const url = `http://${displayHost(host)}:${address.port}${mount}/`;
    const info = { type: 'design-site-started', host, port: address.port, url, root: __dirname };
    if (options.open) maybeOpen(url);
    if (onListen) onListen(info);
    else process.stdout.write(`${JSON.stringify(info)}\n`);
  });
  return server;
}

if (require.main === module) {
  try { startServer(parseArgs(process.argv.slice(2))); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs, startServer };
