// Client for bridge/bridge.py — the loopback bridge into the
// `agy remote-control serve` daemon.
//
// Prompts sent through it become real user turns in the daemon's conversations,
// exactly like messages typed on antigravity.google.com, so the dashboard and
// the session manager stay in sync without tmux or per-session remote instances.
//
// The bridge publishes only its port; the daemon's CSRF token stays inside it.

const fs = require('fs');
const path = require('path');

const ENDPOINT_FILE = path.join(__dirname, 'bridge', 'data', 'endpoint.json');
const HEALTH_TTL_MS = 10 * 1000;

const BOOTSTRAP_HINT =
  "The daemon bridge is not running. In any conversation on antigravity.google.com, ask the agent to run: " +
  "echo '{}' | /usr/bin/python3 " + path.join(__dirname, 'bridge', 'bridge.py') + ' --hook';

let health = { ok: false, ts: 0 };

function readEndpoint() {
  try {
    return Number(JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf-8')).port) || null;
  } catch (e) {
    return null;
  }
}

async function request(method, urlPath, body, timeoutMs = 60000) {
  const port = readEndpoint();
  if (!port) throw new Error(BOOTSTRAP_HINT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || `bridge returned ${res.status}`);
    return json;
  } catch (err) {
    if (err.cause && err.cause.code === 'ECONNREFUSED') throw new Error(BOOTSTRAP_HINT);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function isAvailable() {
  const now = Date.now();
  if (now - health.ts < HEALTH_TTL_MS) return health.ok;
  let ok = false;
  try {
    ok = !!(await request('GET', '/health', null, 3000)).ok;
  } catch (e) {}
  health = { ok, ts: now };
  return ok;
}

// Sends a user turn into a daemon conversation. The bridge picks the model the
// conversation last used.
async function sendPrompt(cid, text) {
  return request('POST', '/send-user', { cid, text });
}

async function newConversation(text, title, model) {
  return request('POST', '/new', { text, title, model }, 300000);
}

module.exports = { isAvailable, sendPrompt, newConversation, BOOTSTRAP_HINT };
