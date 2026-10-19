import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { getCategorizedSessions } = require('./session-discovery.js');
const { parseTranscriptFile } = require('./transcript-parser.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export function resolveTranscriptPath(cid, sessionName) {
  const home = process.env.HOME || '/home/ttolmany';
  const brainDirs = [
    path.join(home, '.gemini/antigravity-cli/brain'),
    path.join(home, '.gemini/antigravity-ide/brain')
  ];

  if (cid) {
    for (const bDir of brainDirs) {
      const p = path.join(bDir, cid, '.system_generated/logs/transcript.jsonl');
      if (fs.existsSync(p)) return p;
    }
  }

  let prefix = cid ? cid.slice(0, 8) : null;
  if (!prefix && sessionName && sessionName.startsWith('rc_')) {
    prefix = sessionName.replace('rc_', '').slice(0, 8);
  }

  if (prefix) {
    for (const bDir of brainDirs) {
      if (!fs.existsSync(bDir)) continue;
      try {
        const entries = fs.readdirSync(bDir);
        for (const entry of entries) {
          if (entry.startsWith(prefix)) {
            const p = path.join(bDir, entry, '.system_generated/logs/transcript.jsonl');
            if (fs.existsSync(p)) return p;
          }
        }
      } catch (e) {}
    }
  }

  return null;
}

export function sendTextToTmux(sessionName, text) {
  if (!sessionName || typeof text !== 'string' || !text.trim()) {
    throw new Error('Missing sessionName or text');
  }
  // Sanitize sessionName (alphanumeric, underscore, dash only)
  if (!/^[a-zA-Z0-9_\-]+$/.test(sessionName)) {
    throw new Error('Invalid session name format');
  }
  if (text.length > 65536) {
    throw new Error('Text exceeds maximum allowed length of 64KB');
  }

  const tmpFile = path.join(os.tmpdir(), `prompt_web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8');
    // 1. Cancel copy-mode in tmux if active
    execSync(`tmux send-keys -t "${sessionName}" -X cancel 2>/dev/null || true`);
    // 2. Load buffer and paste
    execSync(`tmux load-buffer "${tmpFile}"`);
    execSync(`tmux paste-buffer -t "${sessionName}"`);
    // 3. Small flush delay
    execSync(`sleep 0.05`);
    // 4. Send Enter to submit
    execSync(`tmux send-keys -t "${sessionName}" C-m`);
    return true;
  } catch (err) {
    console.error(`Failed to send text to tmux session ${sessionName}:`, err.message);
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

export function createServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 8788);
  const host = options.bindHost || process.env.BIND_HOST || '0.0.0.0';
  const publicDir = path.join(__dirname, 'public');

  const server = http.createServer(async (req, res) => {
    // Enable CORS for development/mobile flexibility
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;

      // 1. GET /api/sessions
      if (req.method === 'GET' && pathname === '/api/sessions') {
        const sessions = await getCategorizedSessions();
        sendJson(res, 200, {
          agy: sessions.agy || [],
          claude: sessions.claude || [],
          codex: sessions.codex || [],
          other: sessions.other || [],
          others: sessions.other || []
        });
        return;
      }

      // 2. GET /api/transcript
      if (req.method === 'GET' && pathname === '/api/transcript') {
        const cid = urlObj.searchParams.get('cid');
        const session = urlObj.searchParams.get('session');
        const limit = Number(urlObj.searchParams.get('limit')) || 50;

        if (!cid && !session) {
          sendError(res, 400, 'Missing cid or session parameter');
          return;
        }

        const tPath = resolveTranscriptPath(cid, session);
        if (!tPath || !fs.existsSync(tPath)) {
          sendJson(res, 200, {
            session,
            cid,
            turns: [],
            totalCount: 0,
            hasEarlier: false,
            notFound: true
          });
          return;
        }

        const parsed = parseTranscriptFile(tPath, limit);
        sendJson(res, 200, {
          session,
          cid,
          turns: parsed.turns,
          totalCount: parsed.totalCount,
          hasEarlier: parsed.hasEarlier
        });
        return;
      }

      // 3. POST /api/send
      if (req.method === 'POST' && pathname === '/api/send') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 65536) {
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const targetSession = data.session || (data.cid ? `rc_${data.cid.slice(0, 8)}` : null);
            const text = data.text;

            if (!targetSession || typeof text !== 'string' || !text.trim()) {
              sendError(res, 400, 'Missing target session or text');
              return;
            }

            sendTextToTmux(targetSession, text.trim());
            sendJson(res, 200, { ok: true, session: targetSession });
          } catch (err) {
            sendError(res, 400, err.message);
          }
        });
        return;
      }

      // 4. Static file serving (public/)
      if (req.method === 'GET') {
        let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
        // Normalize path and prevent directory traversal
        const normalized = path.normalize(filePath);
        if (!normalized.startsWith(publicDir)) {
          sendError(res, 403, 'Forbidden');
          return;
        }

        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
          const ext = path.extname(normalized).toLowerCase();
          const mime = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=3600'
          });
          fs.createReadStream(normalized).pipe(res);
          return;
        }

        // Fallback for single-page app
        const fallback = path.join(publicDir, 'index.html');
        if (fs.existsSync(fallback)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(fallback).pipe(res);
          return;
        }

        sendError(res, 404, 'Not Found');
        return;
      }

      sendError(res, 405, 'Method Not Allowed');
    } catch (err) {
      console.error('Unhandled server error:', err);
      sendError(res, 500, 'Internal Server Error');
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      console.log(`🚀 Session Manager Web Server listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

// Auto-start if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 8788;
  const host = process.env.BIND_HOST || '0.0.0.0';
  createServer({ port, bindHost: host }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
