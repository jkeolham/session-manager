import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { AgentBridgeManager } from './agent-bridge.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const agentBridge = new AgentBridgeManager();

const { getCategorizedSessions } = require('./session-discovery.js');
const { parseTranscriptFile, parseTranscriptString } = require('./transcript-parser.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
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

export function findFullCidByPrefix(prefix) {
  if (!prefix) return null;
  const home = process.env.HOME || '/home/ttolmany';
  const brainDirs = [
    path.join(home, '.gemini/antigravity-cli/brain'),
    path.join(home, '.gemini/antigravity-ide/brain')
  ];
  for (const bDir of brainDirs) {
    if (!fs.existsSync(bDir)) continue;
    try {
      const entries = fs.readdirSync(bDir);
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          return entry;
        }
      }
    } catch (e) {}
  }
  return null;
}

export function sendTextToTmux(sessionName, text, cid = null) {
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

  // Ensure tmux session exists; auto-spawn for rc_* if missing
  try {
    execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`);
  } catch (e) {
    if (sessionName.startsWith('rc_')) {
      const fullCid = (cid && cid.length > 10) ? cid : findFullCidByPrefix(sessionName.replace('rc_', ''));
      if (fullCid) {
        const workDir = path.join(process.env.HOME || '/home/ttolmany', 'gdrive/work/SecondBrain');
        execSync(`tmux new-session -d -s "${sessionName}" -c "${workDir}" "agy --conversation=${fullCid}"`);
        execSync(`sleep 1.5`);
      } else {
        throw new Error(`tmux session ${sessionName} not found and cannot auto-spawn without CID`);
      }
    } else {
      throw new Error(`tmux session ${sessionName} not found`);
    }
  }

  const tmpFile = path.join(os.tmpdir(), `prompt_web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8');
    // 1. Cancel copy-mode in tmux if active
    execSync(`tmux send-keys -t "${sessionName}" -X cancel 2>/dev/null || true`);
    // 2. Load buffer and paste with bracketed mode (-p) to prevent newlines from auto-submitting
    execSync(`tmux load-buffer "${tmpFile}"`);
    execSync(`tmux paste-buffer -p -t "${sessionName}"`);
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

export function captureTmuxPane(sessionName, lines = 300) {
  if (!sessionName || typeof sessionName !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(sessionName)) {
    return null;
  }
  try {
    const out = execSync(`tmux capture-pane -p -J -S -${lines} -t "${sessionName}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
      maxBuffer: 5 * 1024 * 1024
    });
    return out;
  } catch (err) {
    return null;
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
  const port = Number(options.port || process.env.PORT || 8789);
  const host = options.bindHost || process.env.BIND_HOST || '0.0.0.0';
  const publicDir = path.join(__dirname, 'public');
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

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

      // 1.0 GET /api/remote-url
      if (req.method === 'GET' && pathname === '/api/remote-url') {
        const reqCid = urlObj.searchParams.get('cid');
        const fullCid = (reqCid && reqCid.length > 10) ? reqCid : findFullCidByPrefix(reqCid);
        const url = fullCid ? agentBridge.getRelayUrl(fullCid) : null;
        sendJson(res, 200, { cid: fullCid || reqCid, url: url || null });
        return;
      }

      // 1. GET /api/sessions
      if (req.method === 'GET' && pathname === '/api/sessions') {
        const raw = await getCategorizedSessions();

        // Antigravity sessions: Prioritize active Remote Control sessions
        const agyList = [];
        const seenCids = new Set();
        const seenNames = new Set();

        if (Array.isArray(raw.remoteControl)) {
          for (const rc of raw.remoteControl) {
            const shortCid = (rc.cid || '').slice(0, 4);
            const sName = `rc_${(rc.cid || '').slice(0, 8)}`;
            agyList.push({
              name: sName,
              cid: rc.cid,
              title: rc.title || 'AI Session',
              displayName: `[${shortCid}] ${rc.title || 'AI Session'}`,
              cmd: 'agy',
              steps: rc.steps,
              time_str: rc.time_str,
              active: true
            });
            seenCids.add(rc.cid);
            seenNames.add(sName);
          }
        }

        const otherList = [...(raw.other || [])];
        if (Array.isArray(raw.agy)) {
          for (const item of raw.agy) {
            if (seenNames.has(item.name) || (item.cid && seenCids.has(item.cid))) {
              continue;
            }
            if (item.name && item.name.startsWith('rc_')) {
              agyList.push({
                ...item,
                displayName: item.displayName || item.title || item.name,
                active: true
              });
              seenNames.add(item.name);
            } else {
              // Sessions like agy_asset_TAX, agy_jknas_music where cmd === 'bash'
              // These are inactive shell sessions
              otherList.push({
                ...item,
                displayName: `[Shell] ${item.name}`,
                title: item.title ? `${item.title} (대기 셸)` : null,
                active: false
              });
            }
          }
        }

        sendJson(res, 200, {
          agy: agyList,
          claude: raw.claude || [],
          codex: raw.codex || [],
          other: otherList,
          others: otherList
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
        if (tPath && fs.existsSync(tPath)) {
          const parsed = parseTranscriptFile(tPath, limit);
          if (parsed.turns && parsed.turns.length > 0) {
            sendJson(res, 200, {
              session,
              cid,
              turns: parsed.turns,
              totalCount: parsed.totalCount,
              hasEarlier: parsed.hasEarlier
            });
            return;
          }
        }

        // Live terminal fallback for sessions without structured turns (Claude, Codex, shell)
        const targetSession = session || (cid ? `rc_${cid.slice(0, 8)}` : null);
        const termOutput = captureTmuxPane(targetSession);
        if (termOutput !== null) {
          sendJson(res, 200, {
            session: targetSession,
            cid,
            turns: [],
            totalCount: 0,
            hasEarlier: false,
            terminalOutput: termOutput
          });
          return;
        }

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

      // 3. GET /api/stream (Server-Sent Events)
      if (req.method === 'GET' && pathname === '/api/stream') {
        const cid = urlObj.searchParams.get('cid');
        const session = urlObj.searchParams.get('session');

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        const sendEvent = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent('connected', { cid, session, timestamp: Date.now() });

        // Heartbeat ping every 25 seconds
        const pingInterval = setInterval(() => {
          sendEvent('ping', { timestamp: Date.now() });
        }, 25000);

        // File watcher for transcript.jsonl
        let tPath = resolveTranscriptPath(cid, session);
        let lastSize = 0;
        let lineRemainder = '';
        if (tPath && fs.existsSync(tPath)) {
          try {
            lastSize = fs.statSync(tPath).size;
          } catch (e) {}
        }

        // Terminal pane tracking for sessions without transcript file
        let lastTermData = '';
        const targetSession = session || (cid ? `rc_${cid.slice(0, 8)}` : null);
        if (!tPath && targetSession) {
          lastTermData = captureTmuxPane(targetSession, 150) || '';
        }

        const pollInterval = setInterval(() => {
          if (!tPath) {
            tPath = resolveTranscriptPath(cid, session);
            if (tPath && fs.existsSync(tPath)) {
              try {
                lastSize = fs.statSync(tPath).size;
              } catch (e) {}
            }
          }
          if (tPath && fs.existsSync(tPath)) {
            try {
              const stat = fs.statSync(tPath);
              if (stat.size > lastSize) {
                const fd = fs.openSync(tPath, 'r');
                const buffer = Buffer.alloc(stat.size - lastSize);
                fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                fs.closeSync(fd);
                lastSize = stat.size;

                const newChunk = lineRemainder + buffer.toString('utf-8');
                const lastNewline = newChunk.lastIndexOf('\n');
                if (lastNewline !== -1) {
                  const completeLines = newChunk.slice(0, lastNewline + 1);
                  lineRemainder = newChunk.slice(lastNewline + 1);
                  const parsed = parseTranscriptString(completeLines);
                  if (parsed && parsed.turns && parsed.turns.length > 0) {
                    for (const turn of parsed.turns) {
                      sendEvent('turn', turn);
                    }
                  }
                } else {
                  lineRemainder = newChunk;
                }
              } else if (stat.size < lastSize) {
                lastSize = stat.size;
                lineRemainder = '';
              }
            } catch (err) {}
          } else if (targetSession) {
            const currentTerm = captureTmuxPane(targetSession, 150);
            if (currentTerm !== null && currentTerm !== lastTermData) {
              lastTermData = currentTerm;
              sendEvent('terminal', { session: targetSession, text: currentTerm });
            }
          }
        }, 500);

        const onBridgeEvent = ({ cid: eventCid, data }) => {
          const matchCid = cid || (session && session.startsWith('rc_') ? session.replace('rc_', '') : null);
          if (matchCid && eventCid && (eventCid === matchCid || eventCid.startsWith(matchCid.slice(0, 8)))) {
            if (data.event === 'turn' || data.event === 'result') {
              sendEvent('turn', data);
            }
          }
        };
        const onRelayUrl = ({ cid: eventCid, url }) => {
          const matchCid = cid || (session && session.startsWith('rc_') ? session.replace('rc_', '') : null);
          if (matchCid && eventCid && (eventCid === matchCid || eventCid.startsWith(matchCid.slice(0, 8)))) {
            sendEvent('relay-url', { cid: eventCid, url });
          }
        };
        agentBridge.on('event', onBridgeEvent);
        agentBridge.on('relay-url', onRelayUrl);

        req.on('close', () => {
          clearInterval(pingInterval);
          clearInterval(pollInterval);
          agentBridge.off('event', onBridgeEvent);
          agentBridge.off('relay-url', onRelayUrl);
        });

        return;
      }

      // 4. POST /api/upload
      if (req.method === 'POST' && pathname === '/api/upload') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 30 * 1024 * 1024) { // 30MB limit
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const files = Array.isArray(data.files) ? data.files : [];
            if (files.length === 0) {
              sendError(res, 400, 'No files provided');
              return;
            }

            const savedFiles = [];
            for (const f of files) {
              const origName = f.name || 'attachment.bin';
              const ext = path.extname(origName).toLowerCase();
              const base = path.basename(origName, ext).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 32);
              const safeName = `${Date.now()}_${base}${ext || '.bin'}`;
              const destPath = path.join(uploadsDir, safeName);

              let base64 = f.data || '';
              if (base64.includes(';base64,')) {
                base64 = base64.split(';base64,')[1];
              }

              const buffer = Buffer.from(base64, 'base64');
              fs.writeFileSync(destPath, buffer);

              savedFiles.push({
                name: origName,
                safeName,
                destPath,
                path: destPath,
                url: `/uploads/${safeName}`,
                size: buffer.length,
                type: f.type || 'application/octet-stream'
              });
            }

            sendJson(res, 200, { ok: true, files: savedFiles });
          } catch (err) {
            console.error('Upload error:', err);
            sendError(res, 400, err.message);
          }
        });
        return;
      }

      // 5. POST /api/send
      if (req.method === 'POST' && pathname === '/api/send') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 5 * 1024 * 1024) {
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const targetSession = data.session || (data.cid ? `rc_${data.cid.slice(0, 8)}` : null);
            let text = typeof data.text === 'string' ? data.text.trim() : '';
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];

            if (!targetSession && !data.cid) {
              sendError(res, 400, 'Missing target session or cid');
              return;
            }
            if (!text && attachments.length === 0) {
              sendError(res, 400, 'Missing text or attachments');
              return;
            }

            const isAgy = Boolean(
              data.cid ||
              (targetSession && (targetSession.startsWith('rc_') || targetSession.startsWith('agy_')))
            );

            if (isAgy) {
              const rawId = data.cid || (targetSession ? targetSession.replace(/^(rc_|agy_)/, '') : '');
              const fullCid = (rawId && rawId.length > 10) ? rawId : findFullCidByPrefix(rawId);
              if (!fullCid) {
                sendError(res, 400, `Could not resolve conversation ID for session ${targetSession || data.cid}`);
                return;
              }
              agentBridge.sendPrompt(fullCid, text, attachments);
              sendJson(res, 200, { ok: true, bridge: 'agent-bridge', cid: fullCid, session: targetSession });
              return;
            }

            if (attachments.length > 0) {
              const attachLines = attachments.map(a => {
                const p = a.path || a.destPath || a.url || a.name || a;
                return `- ${p}`;
              });
              if (text) text += '\n\n';
              text += `[첨부 파일]\n${attachLines.join('\n')}`;
            }

            sendTextToTmux(targetSession, text, data.cid);
            sendJson(res, 200, { ok: true, bridge: 'tmux', session: targetSession });
          } catch (err) {
            sendError(res, 400, err.message);
          }
        });
        return;
      }

      // 6. Uploaded files serving (/uploads/*)
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/uploads/')) {
        const safeFile = path.basename(pathname);
        const targetPath = path.join(uploadsDir, safeFile);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          const ext = path.extname(targetPath).toLowerCase();
          const mime = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          fs.createReadStream(targetPath).pipe(res);
          return;
        }
        sendError(res, 404, 'Attachment Not Found');
        return;
      }

      // 7. Static file serving (public/)
      if (req.method === 'GET' || req.method === 'HEAD') {
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
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          fs.createReadStream(normalized).pipe(res);
          return;
        }

        // Fallback for single-page app
        const fallback = path.join(publicDir, 'index.html');
        if (fs.existsSync(fallback)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
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
  const port = process.env.PORT || 8789;
  const host = process.env.BIND_HOST || '0.0.0.0';
  createServer({ port, bindHost: host }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
