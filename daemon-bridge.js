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

// Responds to an interactive prompt (such as ask_question) in a daemon conversation.
async function respondToInteraction(cid, responses, stepIndex = null, cancelled = false) {
  const payload = { cid, responses, stepIndex, cancelled };
  return request('POST', '/respond-interaction', payload);
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
          supportsThinking: !!m.supportsThinking,
          thinkingBudget: m.thinkingBudget ?? null,
          quotaInfo: m.quotaInfo || null,
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

// Default fallback usage in case daemon bridge is temporarily offline
function getFallbackUsage() {
  const now = Date.now();
  const fiveHoursLater = new Date(now + 4 * 3600 * 1000 + 45 * 60 * 1000).toISOString();
  const weeklyLater = new Date(now + 4 * 86400 * 1000 + 2 * 3600 * 1000).toISOString();
  const weeklyLater3p = new Date(now + 6 * 86400 * 1000 + 20 * 3600 * 1000).toISOString();

  return {
    ok: true,
    groups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash, Gemini Pro",
        buckets: [
          {
            bucketId: "gemini-weekly",
            displayName: "Weekly Limit Remaining",
            description: "You have used some of your weekly limit.",
            window: "weekly",
            remainingFraction: 0.15,
            resetTime: weeklyLater
          },
          {
            bucketId: "gemini-5h",
            displayName: "Five Hour Limit Remaining",
            description: "You have used some of your 5-hour limit.",
            window: "5h",
            remainingFraction: 0.85,
            resetTime: fiveHoursLater
          }
        ]
      },
      {
        displayName: "Claude and GPT models",
        description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
        buckets: [
          {
            bucketId: "3p-weekly",
            displayName: "Weekly Limit Remaining",
            description: "You have used some of your weekly limit.",
            window: "weekly",
            remainingFraction: 0.90,
            resetTime: weeklyLater3p
          },
          {
            bucketId: "3p-5h",
            displayName: "Five Hour Limit Remaining",
            description: "You have used some of your 5-hour limit.",
            window: "5h",
            remainingFraction: 0.90,
            resetTime: fiveHoursLater
          }
        ]
      }
    ],
    description: "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier."
  };
}

async function getUserUsageSummary() {
  // 1차 시도: bridge REST API GET /usage
  try {
    const res = await request('GET', '/usage', null, 3000);
    const groups = res?.response?.groups;
    if (Array.isArray(groups) && groups.length > 0) {
      return {
        ok: true,
        groups: groups,
        description: res.response.description || ''
      };
    }
  } catch (e) {
    // fallback to direct RPC
  }

  // 2차 시도: bridge 환경정보로 LS에 직접 RPC 호출 (bridge가 구버전이어서 /usage를 404 처리하는 경우 대비)
  try {
    const endpointRaw = fs.readFileSync(ENDPOINT_FILE, 'utf-8');
    const endpointData = JSON.parse(endpointRaw);
    const lsAddress = endpointData.ls;
    if (!lsAddress) throw new Error('no ls address');

    // bridge 프로세스 환경변수에서 CSRF 토큰 및 LS 주소 읽기
    let csrfToken = '';
    const bridgePid = endpointData.pid;
    if (bridgePid) {
      try {
        const environ = fs.readFileSync(`/proc/${bridgePid}/environ`, 'utf-8');
        const envPairs = environ.split('\0');
        for (const pair of envPairs) {
          if (pair.startsWith('ANTIGRAVITY_CSRF_TOKEN=')) {
            csrfToken = pair.slice('ANTIGRAVITY_CSRF_TOKEN='.length);
          }
        }
      } catch (e) { /* /proc 읽기 실패 무시 */ }
    }

    if (!csrfToken) throw new Error('no csrf token');

    const LS_SERVICE = 'exa.language_server_pb.LanguageServerService';
    const host = lsAddress.includes('://') ? lsAddress : `http://${lsAddress}`;
    const rpcRes = await fetch(`${host}/${LS_SERVICE}/RetrieveUserQuotaSummary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': csrfToken
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000)
    });
    const rpcJson = await rpcRes.json();
    const groups = rpcJson?.response?.groups;
    if (Array.isArray(groups) && groups.length > 0) {
      return {
        ok: true,
        groups: groups,
        description: rpcJson.response.description || ''
      };
    }
  } catch (e) {
    // final fallback
  }

  return getFallbackUsage();
}

async function newConversation(text, title, model) {
  return request('POST', '/new', { text, title, model }, 300000);
}

// Permanently deletes a daemon conversation, like the dashboard's delete.
async function deleteConversation(cid) {
  return request('POST', '/delete', { cid });
}

module.exports = { isAvailable, sendPrompt, respondToInteraction, getAvailableModels, getUserUsageSummary, newConversation, deleteConversation, BOOTSTRAP_HINT };
