const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONVERSATION_DB_PATH = path.join(
  process.env.HOME || '/home/ttolmany',
  '.gemini/antigravity-cli/conversation_summaries.db'
);
const REMOTE_SESSIONS_PY = path.join(__dirname, 'remote-sessions.py');

let conversationTitleCache = {};

function getRemoteControlSessions() {
  if (!fs.existsSync(REMOTE_SESSIONS_PY)) {
    return [];
  }
  try {
    const out = execFileSync('python3', [REMOTE_SESSIONS_PY], { encoding: 'utf-8', timeout: 5000 });
    return JSON.parse(out.trim() || '[]');
  } catch (err) {
    console.error('Error in getRemoteControlSessions:', err);
    return [];
  }
}

function getConversationTitles() {
  const sessions = getRemoteControlSessions();
  const map = {};
  for (const s of sessions) {
    map[s.cid] = { title: s.title };
  }
  return map;
}

function getConversationIdFromPane(sessionName) {
  try {
    const paneOutput = execSync(`tmux capture-pane -p -t "${sessionName}"`, {
      encoding: 'utf-8',
      timeout: 3000
    });
    const match = paneOutput.match(/agy --conversation=([0-9a-fA-F-]+)/);
    if (match) {
      return match[1];
    }
  } catch (e) {
    // Ignore pane capture errors
  }
  return null;
}

async function getCategorizedSessions() {
  const result = {
    remoteControl: getRemoteControlSessions(),
    agy: [],
    claude: [],
    codex: [],
    other: []
  };

  let stdout = '';
  try {
    stdout = execSync('tmux list-panes -a -F "#{session_name}:::#{pane_pid}:::#{pane_current_command}"', {
      encoding: 'utf-8',
      timeout: 5000
    });
  } catch (err) {
    return result;
  }

  const lines = stdout.trim().split('\n').filter(Boolean);
  const titles = getConversationTitles();

  const seenSessions = new Set();

  for (const line of lines) {
    const parts = line.split(':::');
    if (parts.length < 3) continue;
    const sessionName = parts[0].trim();
    const pid = parseInt(parts[1].trim(), 10);
    const cmd = parts[2].trim();

    if (seenSessions.has(sessionName)) continue;
    seenSessions.add(sessionName);

    const sessionObj = {
      name: sessionName,
      pid,
      cmd,
      title: null,
      cid: null
    };

    if (sessionName.startsWith('agy_')) {
      const cid = getConversationIdFromPane(sessionName);
      if (cid) {
        sessionObj.cid = cid;
        if (titles[cid] && titles[cid].title) {
          sessionObj.title = titles[cid].title;
        }
      }
      result.agy.push(sessionObj);
    } else if (cmd === 'claude' || sessionName.toLowerCase().includes('claude')) {
      result.claude.push(sessionObj);
    } else if (cmd === 'codex' || sessionName.startsWith('codex_')) {
      result.codex.push(sessionObj);
    } else {
      if (['Fishing', 'Hojak', 'JellyFin_project', 'Tax_Asset', 'english_study',
           'family_tree', 'fishing_boat_reservation_dev', 'headless_mode_claude',
           'headlessmode_development', 'hojak_emulator', 'infinit_buy_VR',
           'living_manager', 'migration_server_management', 'my_apartment_complex',
           'reading-reviews', 'shopping_monitoring', 'status_and_monitoring',
           'system_expert_2024', 'current_timing_watcher'].includes(sessionName)) {
        result.claude.push(sessionObj);
      } else {
        result.other.push(sessionObj);
      }
    }
  }

  result.agy.sort((a, b) => a.name.localeCompare(b.name));
  result.claude.sort((a, b) => a.name.localeCompare(b.name));
  result.codex.sort((a, b) => a.name.localeCompare(b.name));
  result.other.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

module.exports = {
  getCategorizedSessions,
  getRemoteControlSessions,
  getConversationTitles
};
