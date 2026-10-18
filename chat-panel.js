const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { parseTranscriptFile } = require('./transcript-parser');

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getPanelKey(session) {
  if (session.cid) {
    return `rc_${session.cid.slice(0, 8)}`;
  }
  return session.name || 'unknown_session';
}

function resolveTranscriptPath(cid, sessionName) {
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

function getTranscriptPath(cid, sessionName) {
  const resolved = resolveTranscriptPath(cid, sessionName);
  if (resolved) return resolved;
  const home = process.env.HOME || '/home/ttolmany';
  return path.join(home, '.gemini/antigravity-cli/brain', cid || 'unknown', '.system_generated/logs/transcript.jsonl');
}

class SessionChatPanelManager {
  constructor(extensionUri, subscriptions, sendTextToTmuxFn) {
    this.extensionUri = extensionUri;
    this.subscriptions = subscriptions;
    this.sendTextToTmux = sendTextToTmuxFn;
    this.panels = new Map(); // key -> { panel, session, sessionName, tPath, lastMtime, limit, isTermActive, pollTimer }
  }

  syncTranscript(cid) {
    const key = `rc_${cid.slice(0, 8)}`;
    const record = this.panels.get(key);
    if (record && record.panel) {
      const tPath = resolveTranscriptPath(cid, record.sessionName);
      if (tPath) {
        const parsed = parseTranscriptFile(tPath, record.limit || 50);
        record.panel.webview.postMessage({
          type: 'initTurns',
          turns: parsed.turns,
          totalCount: parsed.totalCount,
          hasEarlier: parsed.hasEarlier,
          session: record.session
        });
      }
    }
  }

  openOrRevealPanel(vscode, session) {
    const key = getPanelKey(session);
    const existing = this.panels.get(key);
    if (existing && existing.panel) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return existing.panel;
    }

    const shortCid = session.cid ? `[${session.cid.slice(0, 4)}] ` : '';
    const title = `${shortCid}${session.title || session.name || 'AI Session'}`;

    const panel = vscode.window.createWebviewPanel(
      'sessionChatView',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
      }
    );

    const sessionName = session.cid ? `rc_${session.cid.slice(0, 8)}` : session.name;
    const tPath = resolveTranscriptPath(session.cid, sessionName);

    const record = {
      panel,
      session,
      sessionName,
      tPath,
      lastMtime: 0,
      limit: 50,
      isTermActive: false,
      pollTimer: null
    };

    this.panels.set(key, record);

    const sendTurnsToWebview = (isInit = false) => {
      if (!record.tPath) {
        record.tPath = resolveTranscriptPath(record.session.cid, record.sessionName);
      }
      if (!record.tPath || !fs.existsSync(record.tPath)) return;

      try {
        const stat = fs.statSync(record.tPath);
        if (!isInit && stat.mtimeMs === record.lastMtime) return;
        record.lastMtime = stat.mtimeMs;

        const parsed = parseTranscriptFile(record.tPath, record.limit);
        record.panel.webview.postMessage({
          type: isInit ? 'initTurns' : 'updateTurns',
          turns: parsed.turns,
          totalCount: parsed.totalCount,
          hasEarlier: parsed.hasEarlier,
          session: record.session
        });
      } catch (err) {}
    };

    const sendTerminalToWebview = (isInit = false) => {
      try {
        if (isInit) {
          execSync(`tmux resize-window -t "${record.sessionName}" -x 120 -y 40 2>/dev/null`);
        }
        const pane = execSync(`tmux capture-pane -p -J -S -3000 -t "${record.sessionName}" 2>/dev/null`, { encoding: 'utf-8' });
        record.panel.webview.postMessage({
          type: isInit ? 'termInit' : 'termOutput',
          data: pane
        });
      } catch (err) {}
    };

    // Live background polling (1.2s interval)
    record.pollTimer = setInterval(() => {
      if (!record.panel.visible) return;

      // 1. Sync Chat turns if transcript modified
      sendTurnsToWebview(false);

      // 2. Sync Console terminal if active
      if (record.isTermActive) {
        sendTerminalToWebview(false);
      }
    }, 1200);

    panel.onDidDispose(() => {
      if (record.pollTimer) clearInterval(record.pollTimer);
      this.panels.delete(key);
    }, null, this.subscriptions);

    panel.webview.html = this.getHtmlForWebview(panel.webview, session, title);

    panel.webview.onDidReceiveMessage((data) => {
      if (data.command === 'ready' || data.command === 'syncTurns') {
        sendTurnsToWebview(true);
      } else if (data.command === 'loadMoreTurns') {
        record.limit += 50;
        sendTurnsToWebview(true);
      } else if (data.command === 'sendPrompt') {
        if (this.sendTextToTmux) {
          this.sendTextToTmux(record.sessionName, data.text);
        }
        // Rapid response checks after prompt
        setTimeout(() => sendTurnsToWebview(false), 600);
        setTimeout(() => sendTurnsToWebview(false), 1600);
      } else if (data.command === 'termActivate') {
        record.isTermActive = true;
        try {
          execSync(`tmux resize-window -t "${record.sessionName}" -x 120 -y 40 2>/dev/null`);
        } catch (e) {}
        sendTerminalToWebview(true);
      } else if (data.command === 'termResize') {
        if (data.cols && data.cols >= 60 && data.cols <= 260) {
          try {
            execSync(`tmux resize-window -t "${record.sessionName}" -x ${data.cols} 2>/dev/null`);
            sendTerminalToWebview(false);
          } catch (e) {}
        }
      } else if (data.command === 'termDeactivate') {
        record.isTermActive = false;
      } else if (data.command === 'termData') {
        try {
          execSync(`tmux send-keys -t "${record.sessionName}" -l ${JSON.stringify(data.data)} 2>/dev/null`);
        } catch (e) {}
      } else if (data.command === 'openLink') {
        if (data.url && data.url.startsWith('file://')) {
          const filePath = data.url.replace(/^file:\/\//, '');
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        } else if (data.url) {
          vscode.env.openExternal(vscode.Uri.parse(data.url));
        }
      }
    });

    return panel;
  }

  getHtmlForWebview(webview, session, displayTitle) {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <title>${displayTitle}</title>
  <link rel="stylesheet" href="${webview.asWebviewUri(this.extensionUri)}/media/chat.css">
</head>
<body>
  <div class="panel-container">
    <header class="chat-header">
      <div class="header-left">
        <span class="status-indicator active"></span>
        <span class="breadcrumb-prefix">CLI Session</span>
        <span class="breadcrumb-sep">/</span>
        <span class="header-title">${displayTitle}</span>
      </div>
      <div class="tab-switcher">
        <button id="tab-chat" class="tab-btn active"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:5px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>AI 대화창</button>
        <button id="tab-term" class="tab-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:5px;"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>콘솔 터미널</button>
      </div>
      <div class="header-actions">
        <button id="btn-sync" title="최신 대화 동기화">🔄</button>
        <button id="btn-copy" title="전체 대화 복사">📋</button>
      </div>
    </header>

    <div id="view-chat" class="view-content active">
      <div id="messages-container" class="messages-container">
        <div id="empty-state" class="empty-state">대화 기록을 불러오는 중입니다...</div>
      </div>
      <div class="composer-container">
        <textarea id="composer-input" placeholder="메시지를 입력하세요 (마우스 드래그 선택/삭제, Shift+방향키, Ctrl+C/V/X 지원)..."></textarea>
        <div class="composer-footer">
          <label class="toggle-wrap">
            <input type="checkbox" id="enter-send-toggle" checked />
            <span>Enter 전송</span>
          </label>
          <div class="btn-group">
            <button id="btn-clear" class="btn-secondary">지우기</button>
            <button id="btn-send" class="btn-primary">전송 🚀</button>
          </div>
        </div>
      </div>
    </div>

    <div id="view-term" class="view-content">
      <div id="terminal-container" class="terminal-container">
        <pre id="terminal-output"></pre>
        <button id="btn-term-scroll-bottom" class="term-scroll-btn" style="display:none;">⬇ 최신 터미널 출력으로 이동</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${webview.asWebviewUri(this.extensionUri)}/media/chat.js"></script>
  <script nonce="${nonce}" src="${webview.asWebviewUri(this.extensionUri)}/media/terminal.js"></script>
</body>
</html>`;
  }
}

module.exports = {
  getNonce,
  getPanelKey,
  resolveTranscriptPath,
  getTranscriptPath,
  SessionChatPanelManager
};
