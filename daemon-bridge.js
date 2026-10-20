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

// Sends a user turn into a daemon conversation. If plannerConfig or model is provided,
// it directs the daemon to run with that specific model; otherwise the bridge picks
// the model the conversation last used.
async function sendPrompt(cid, text, plannerConfig) {
  const payload = { cid, text };
  if (plannerConfig) {
    payload.plannerConfig = plannerConfig;
  }
  return request('POST', '/send-user', payload);
}

// Default recommended models aligned with Antigravity 2.0
const FALLBACK_MODELS = [
  {
    id: 'gemini-3.8-flash-high',
    displayName: 'Gemini 3.8 Flash',
    subLabel: 'High',
    model: 'MODEL_PLACEHOLDER_M318',
    isDefault: true,
    disabled: false
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6 (Thinking)',
    subLabel: 'Notice ⓘ',
    tagTitle: 'Notice',
    tagDescription: 'Sonnet 5.5 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 2, 2026.',
    model: 'MODEL_PLACEHOLDER_M35',
    disabled: false
  },
  {
    id: 'claude-opus-4-6-thinking',
    displayName: 'Claude Opus 4.6 (Thinking)',
    subLabel: 'Notice ⓘ',
    tagTitle: 'Notice',
    tagDescription: 'Opus 5.5 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 2, 2026.',
    model: 'MODEL_PLACEHOLDER_M26',
    disabled: false
  },
  {
    id: 'gpt-oss-120b-medium',
    displayName: 'GPT-OSS 120B (Medium)',
    subLabel: 'Notice ⓘ',
    tagTitle: 'Notice',
    tagDescription: 'GPT-OSS will be removed from Antigravity on November 2, 2026.',
    model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    disabled: false
  },
  {
    id: 'gemini-4-argon-disabled',
    displayName: 'Gemini 4 Argon',
    subLabel: 'Unavailable ⓘ',
    tagTitle: 'Unavailable',
    tagDescription: 'Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.',
    model: 'MODEL_PLACEHOLDER_M421',
    disabled: true
  }
];

async function getAvailableModels() {
  try {
    const res = await request('GET', '/models', null, 3000);
    const modelsMap = res?.response?.models || {};
    const sorts = res?.response?.agentModelSorts?.[0]?.groups?.[0]?.modelIds || [];

    if (sorts.length > 0) {
      const items = sorts.map(mid => {
        const m = modelsMap[mid] || {};
        const disabled = mid.includes('disabled') || !modelsMap[mid];
        let subLabel = '';
        if (m.tagTitle) {
          subLabel = `${m.tagTitle} ⓘ`;
        } else if (mid.includes('high')) {
          subLabel = 'High';
        } else if (mid.includes('medium')) {
          subLabel = 'Medium';
        } else if (mid.includes('low')) {
          subLabel = 'Low';
        }

        return {
          id: mid,
          displayName: m.displayName || mid,
          subLabel,
          tagTitle: m.tagTitle || null,
          tagDescription: m.tagDescription || null,
          model: m.model || mid,
          isDefault: mid === (res?.response?.defaultAgentModelId || 'gemini-3.8-flash-high'),
          disabled
        };
      });
      return { ok: true, models: items };
    }
  } catch (e) {
    // bridge or daemon unavailable, fallback to presets
  }
  return { ok: true, models: FALLBACK_MODELS };
}

async function newConversation(text, title, model) {
  return request('POST', '/new', { text, title, model }, 300000);
}

// Permanently deletes a daemon conversation, like the dashboard's delete.
async function deleteConversation(cid) {
  return request('POST', '/delete', { cid });
}

module.exports = { isAvailable, sendPrompt, getAvailableModels, newConversation, deleteConversation, BOOTSTRAP_HINT };
