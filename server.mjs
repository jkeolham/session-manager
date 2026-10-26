import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { getCategorizedSessions } = require('./session-discovery.js');
const { parseTranscriptFile, parseTranscriptString } = require('./transcript-parser.js');
const daemonBridge = require('./daemon-bridge.js');

const ALLOWED_UPLOAD_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.txt', '.md', '.json', '.log',
  '.py', '.js', '.ts', '.mjs', '.sh', '.csv'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

  function getBestTranscript(dir) {
    // Prefer transcript_full.jsonl to prevent content truncation on long turns/tables
    const full = path.join(dir, '.system_generated/logs/transcript_full.jsonl');
    if (fs.existsSync(full)) return full;
    const compact = path.join(dir, '.system_generated/logs/transcript.jsonl');
    if (fs.existsSync(compact)) return compact;
    return null;
  }

  if (cid) {
    for (const bDir of brainDirs) {
      const best = getBestTranscript(path.join(bDir, cid));
      if (best) return best;
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
            const best = getBestTranscript(path.join(bDir, entry));
            if (best) return best;
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

  // Antigravity conversations are never typed into a TUI (the daemon owns them);
  // only existing Claude/Codex/shell tmux sessions get here.
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) {
    throw new Error(`tmux session ${sessionName} not found`);
  }

  const tmpFile = path.join(os.tmpdir(), `prompt_web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8');
    // 1. Cancel copy-mode in tmux if active
    try {
      execFileSync('tmux', ['send-keys', '-t', sessionName, '-X', 'cancel'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (e) {}
    // 2. Load buffer and paste with bracketed mode (-p) to prevent newlines from auto-submitting
    execFileSync('tmux', ['load-buffer', tmpFile], { stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('tmux', ['paste-buffer', '-p', '-t', sessionName], { stdio: ['ignore', 'ignore', 'ignore'] });
    // 3. Small flush delay
    execFileSync('sleep', ['0.05'], { stdio: ['ignore', 'ignore', 'ignore'] });
    // 4. Send Enter to submit
    execFileSync('tmux', ['send-keys', '-t', sessionName, 'C-m'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (err) {
    console.error(`Failed to send text to tmux session ${sessionName}:`, err.message);
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

// The official web dashboard URL for an Antigravity conversation.
// antigravity.google.com is the authenticated top-level host.
// (static.usercontent.goog is an internal sandboxed iframe that cannot be opened directly in a browser tab without losing auth/context)
export function dashboardUrlForConversation(cid) {
  if (!cid) return 'https://antigravity.google.com';
  return `https://antigravity.google.com/c/${cid}`;
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

    // CSRF Defense: Block cross-origin state-changing requests (POST/PUT/DELETE)
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            sendError(res, 403, 'Cross-Origin Forbidden');
            return;
          }
        } catch (e) {
          sendError(res, 403, 'Invalid Origin Header');
          return;
        }
      }
    }

    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;

      // 1.0 GET /api/remote-url
      if (req.method === 'GET' && pathname === '/api/remote-url') {
        const reqCid = urlObj.searchParams.get('cid');
        const fullCid = (reqCid && reqCid.length > 10) ? reqCid : findFullCidByPrefix(reqCid);
        const url = dashboardUrlForConversation(fullCid);
        sendJson(res, 200, { cid: fullCid || reqCid, url });
        return;
      }

      // 1.00 GET /api/models — return available models for agent conversations
      if (req.method === 'GET' && pathname === '/api/models') {
        try {
          const result = await daemonBridge.getAvailableModels();
          sendJson(res, 200, result);
        } catch (err) {
          sendError(res, 500, err.message);
        }
        return;
      }

      // 1.00b GET /api/usage — return quota and usage metrics
      if (req.method === 'GET' && pathname === '/api/usage') {
        try {
          const result = await daemonBridge.getUserUsageSummary();
          sendJson(res, 200, result);
        } catch (err) {
          sendError(res, 500, err.message);
        }
        return;
      }

      // 1.01 GET /api/diff — return git status and diff for the session's workspace
      if (req.method === 'GET' && pathname === '/api/diff') {
        const cid = urlObj.searchParams.get('cid');
        const session = urlObj.searchParams.get('session');
        const fullCid = (cid && cid.length > 10) ? cid : findFullCidByPrefix(cid);
        const targetSession = session || (fullCid ? `rc_${fullCid.slice(0, 8)}` : null);

        let cwd = null;
        if (targetSession) {
          if (!/^[a-zA-Z0-9_\-]+$/.test(targetSession)) {
            sendError(res, 400, 'Invalid session name format');
            return;
          }
          try {
            cwd = execFileSync('tmux', ['display-message', '-p', '-t', targetSession, '#{pane_current_path}'], {
              encoding: 'utf-8',
              timeout: 2000,
              stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
          } catch (e) {}
        }

        if (!cwd || !fs.existsSync(cwd)) {
          cwd = process.cwd();
        }

        try {
          const statRaw = execSync('git diff --stat 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
          const diffRaw = execSync('git diff 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }).trim();
          const statusRaw = execSync('git status --short 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();

          let filesChanged = 0;
          let insertions = 0;
          let deletions = 0;

          if (statRaw) {
            const lastLine = statRaw.split('\n').pop() || '';
            const matchFiles = lastLine.match(/(\d+)\s+file/);
            const matchIns = lastLine.match(/(\d+)\s+insertion/);
            const matchDel = lastLine.match(/(\d+)\s+deletion/);
            if (matchFiles) filesChanged = parseInt(matchFiles[1], 10);
            if (matchIns) insertions = parseInt(matchIns[1], 10);
            if (matchDel) deletions = parseInt(matchDel[1], 10);
          }

          sendJson(res, 200, {
            ok: true,
            cwd,
            filesChanged,
            insertions,
            deletions,
            stat: statRaw,
            status: statusRaw,
            diff: diffRaw,
            summary: filesChanged > 0 ? `${filesChanged} files changed (+${insertions} -${deletions})` : '변경된 파일 없음'
          });
        } catch (err) {
          sendJson(res, 200, {
            ok: false,
            cwd,
            filesChanged: 0,
            summary: 'Diff 조회 불가',
            diff: ''
          });
        }
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
              ...rc,
              name: sName,
              cid: rc.cid,
              title: rc.title || 'AI Session',
              displayName: `[${shortCid}] ${rc.title || 'AI Session'}`,
              cmd: 'agy',
              steps: rc.steps,
              time_str: rc.time_str,
              timeAgo: rc.timeAgo || '',
              isRunning: !!rc.isRunning,
              isRecent: !!rc.isRecent,
              status: rc.status || 'CASCADE_RUN_STATUS_IDLE',
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
        const limit = Number(urlObj.searchParams.get('limit')) || 100;
        const beforeRaw = urlObj.searchParams.get('before');
        const before = (beforeRaw !== null && beforeRaw !== '') ? Number(beforeRaw) : null;

        if (!cid && !session) {
          sendError(res, 400, 'Missing cid or session parameter');
          return;
        }

        const tPath = resolveTranscriptPath(cid, session);
        if (tPath && fs.existsSync(tPath)) {
          const parsed = parseTranscriptFile(tPath, limit, before);
          if (parsed.turns && parsed.turns.length > 0) {
            sendJson(res, 200, {
              session,
              cid,
              turns: parsed.turns,
              totalCount: parsed.totalCount,
              hasEarlier: parsed.hasEarlier,
              earliestIndex: parsed.earliestIndex,
              latestIndex: parsed.latestIndex
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
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*'
        });

        const sendEvent = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent('connected', { cid, session, timestamp: Date.now() });

        // Emit relay-url with canonical dashboard URL for this conversation
        const resolvedCid = (cid && cid.length > 10) ? cid : findFullCidByPrefix(cid || (session ? session.replace(/^(rc_|agy_)/, '') : null));
        if (resolvedCid) {
          sendEvent('relay-url', { cid: resolvedCid, url: dashboardUrlForConversation(resolvedCid) });
        }

        // Heartbeat ping every 25 seconds
        const pingInterval = setInterval(() => {
          sendEvent('ping', { timestamp: Date.now() });
        }, 25000);

        // File watcher for transcript.jsonl
        let tPath = resolveTranscriptPath(cid, session);
        let lastSize = 0;
        let lineRemainder = '';
        const decoder = new StringDecoder('utf-8');
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
                let fd = null;
                let buffer = null;
                try {
                  fd = fs.openSync(tPath, 'r');
                  buffer = Buffer.alloc(stat.size - lastSize);
                  fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                  lastSize = stat.size;
                } finally {
                  if (fd !== null) {
                    try { fs.closeSync(fd); } catch (e) {}
                  }
                }

                if (buffer && buffer.length > 0) {
                  const decoded = decoder.write(buffer);
                  const newChunk = lineRemainder + decoded;
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

        req.on('close', () => {
          clearInterval(pingInterval);
          clearInterval(pollInterval);
          try { decoder.end(); } catch (e) {}
        });

        return;
      }

      // 4. POST /api/upload
      if (req.method === 'POST' && pathname === '/api/upload') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 15 * 1024 * 1024) { // 15MB limit to prevent OOM
            req.destroy();
          }
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            body = null; // Free JSON string memory immediately
            const files = Array.isArray(data.files) ? data.files : [];
            if (files.length === 0) {
              sendError(res, 400, 'No files provided');
              return;
            }

            const savedFiles = [];
            for (const f of files) {
              const origName = f.name || 'attachment.bin';
              const ext = path.extname(origName).toLowerCase();

              // Security: validate extension against strict whitelist
              if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
                sendError(res, 400, `File extension '${ext || 'none'}' is not allowed for security reasons`);
                return;
              }

              const base = path.basename(origName, ext).replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 32);
              const safeName = `${Date.now()}_${base}${ext}`;
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
        req.on('end', async () => {
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

            if (attachments.length > 0) {
              const attachLines = attachments.map(a => {
                const p = a.path || a.destPath || a.url || a.name || a;
                return `- ${p}`;
              });
              if (text) text += '\n\n';
              text += `[첨부 파일]\n${attachLines.join('\n')}`;
            }

            const rawId = data.cid || (targetSession && (targetSession.startsWith('rc_') || targetSession.startsWith('agy_'))
              ? targetSession.replace(/^(rc_|agy_)/, '')
              : '');
            const fullCid = (rawId && rawId.length > 10) ? rawId : findFullCidByPrefix(rawId);
            const resolvedSession = targetSession || (fullCid ? `rc_${fullCid.slice(0, 8)}` : null);

            if (!resolvedSession) {
              sendError(res, 400, `Could not resolve target session`);
              return;
            }

            // Antigravity conversations run inside the remote-control daemon — the
            // agent instance the dashboard drives — so they go only through the
            // daemon bridge. Typing into a tmux TUI of the same conversation would
            // start a second copy of it that the dashboard never sees.
            const cid = fullCid || data.cid;
            if (cid && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(cid)) {
              try {
                let plannerConfig = data.plannerConfig || null;
                if (!plannerConfig && data.model) {
                  plannerConfig = {
                    planModel: data.model,
                    requestedModel: { model: data.model }
                  };
                }
                await daemonBridge.sendPrompt(cid, text, plannerConfig);
                sendJson(res, 200, { ok: true, bridge: 'daemon', session: resolvedSession, cid, model: data.model });
              } catch (err) {
                sendError(res, 503, err.message);
              }
              return;
            }

            // Claude Code, Codex and plain shells still live in tmux.

            sendTextToTmux(resolvedSession, text, cid);
            sendJson(res, 200, { ok: true, bridge: 'tmux', session: resolvedSession, cid });
          } catch (err) {
            sendError(res, 400, err.message);
          }
        });
        return;
      }

      // 5.1 POST /api/new — start a new Antigravity conversation inside the daemon
      if (req.method === 'POST' && pathname === '/api/new') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 1024 * 1024) req.destroy();
        });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const text = typeof data.text === 'string' ? data.text.trim() : '';
            if (!text) {
              sendError(res, 400, 'Missing text');
              return;
            }
            const result = await daemonBridge.newConversation(text, data.title, data.model);
            sendJson(res, 200, { ok: true, bridge: 'daemon', result });
          } catch (err) {
            sendError(res, 503, err.message);
          }
        });
        return;
      }

      // 5.2 POST /api/delete — permanently delete a daemon conversation
      if (req.method === 'POST' && pathname === '/api/delete') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy();
        });
        req.on('end', async () => {
          try {
            const cid = String(JSON.parse(body || '{}').cid || '');
            if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(cid)) {
              sendError(res, 400, 'Missing full conversation id');
              return;
            }
            // The daemon delete is what removes it from the dashboard; only then
            // clear leftover files the session list is built from.
            await daemonBridge.deleteConversation(cid);
            execFileSync('python3', [path.join(__dirname, 'delete-session.py'), cid], { timeout: 10000 });
            sendJson(res, 200, { ok: true, cid });
          } catch (err) {
            sendError(res, 503, err.message);
          }
        });
        return;
      }

      // 5.3 POST /api/rename — rename an Antigravity conversation title or tmux session
      if (req.method === 'POST' && pathname === '/api/rename') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy();
        });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const cid = typeof data.cid === 'string' ? data.cid.trim() : '';
            const session = typeof data.session === 'string' ? data.session.trim() : '';
            const newTitle = typeof data.title === 'string' ? data.title.trim() : (typeof data.newName === 'string' ? data.newName.trim() : '');

            if (!newTitle) {
              sendError(res, 400, 'Title cannot be empty');
              return;
            }
            if (newTitle.length > 120) {
              sendError(res, 400, 'Title cannot exceed 120 characters');
              return;
            }

            // Case A: Antigravity Session with full or prefix cid
            if (cid) {
              const fullCid = (cid.length > 10) ? cid : findFullCidByPrefix(cid);
              if (!fullCid || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(fullCid)) {
                sendError(res, 400, 'Invalid conversation id');
                return;
              }
              execFileSync('python3', [path.join(__dirname, 'rename-session.py'), fullCid, newTitle], {
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'ignore']
              });
              sendJson(res, 200, { ok: true, type: 'agy', cid: fullCid, title: newTitle });
              return;
            }

            // Case B: Tmux Session renaming
            if (session) {
              if (!/^[a-zA-Z0-9_\-]+$/.test(session)) {
                sendError(res, 400, 'Invalid source session name format');
                return;
              }
              if (!/^[a-zA-Z0-9_\-]+$/.test(newTitle)) {
                sendError(res, 400, 'Tmux session name must only contain alphanumeric, underscore, or dash characters');
                return;
              }
              execFileSync('tmux', ['rename-session', '-t', session, newTitle], {
                timeout: 3000,
                stdio: ['ignore', 'pipe', 'ignore']
              });
              sendJson(res, 200, { ok: true, type: 'tmux', oldSession: session, session: newTitle, title: newTitle });
              return;
            }

            sendError(res, 400, 'Missing cid or session parameter');
          } catch (err) {
            console.error('Rename error:', err);
            sendError(res, 500, err.message);
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
            'Access-Control-Allow-Origin': '*',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
            'X-Content-Type-Options': 'nosniff'
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
