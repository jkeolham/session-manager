const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
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
  constructor(extensionUri, subscriptions, sendTextToTmuxFn, attachToSessionFn, attachRemoteControlFn) {
    this.extensionUri = extensionUri;
    this.subscriptions = subscriptions;
    this.sendTextToTmux = sendTextToTmuxFn;
    this.attachToSession = attachToSessionFn;
    this.attachRemoteControl = attachRemoteControlFn;
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

    let lastPaneData = '';
    const sendTerminalToWebview = (isInit = false) => {
      if (!record.sessionName) return;
      if (isInit) {
        try {
          execSync(`tmux resize-window -t "${record.sessionName}" -x 120 -y 40 2>/dev/null`);
        } catch (e) {}
      }
      exec(`tmux capture-pane -p -J -S -500 -t "${record.sessionName}" 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err || stdout === undefined) return;
        if (!isInit && stdout === lastPaneData) {
          return;
        }
        lastPaneData = stdout;
        record.panel.webview.postMessage({
          type: isInit ? 'termInit' : 'termOutput',
          data: stdout
        });
      });
    };

    // Fast polling for interactive terminal (100ms)
    let termFastTimer = null;
    const startTermFastPolling = () => {
      if (termFastTimer) clearInterval(termFastTimer);
      termFastTimer = setInterval(() => {
        if (!record.panel.visible || !record.isTermActive) return;
        sendTerminalToWebview(false);
      }, 100);
    };

    const stopTermFastPolling = () => {
      if (termFastTimer) {
        clearInterval(termFastTimer);
        termFastTimer = null;
      }
    };

    // Live background polling for Chat (1.2s interval)
    record.pollTimer = setInterval(() => {
      if (!record.panel.visible) return;
      sendTurnsToWebview(false);
    }, 1200);

    panel.onDidDispose(() => {
      if (record.pollTimer) clearInterval(record.pollTimer);
      stopTermFastPolling();
      this.panels.delete(key);
    }, null, this.subscriptions);

    panel.webview.html = this.getHtmlForWebview(panel.webview, session, title);

    panel.webview.onDidReceiveMessage((data) => {
      if (data.command === 'ready' || data.command === 'syncTurns') {
        sendTurnsToWebview(true);
      } else if (data.command === 'loadMoreTurns') {
        record.limit += 50;
        if (!record.tPath) {
          record.tPath = resolveTranscriptPath(record.session.cid, record.sessionName);
        }
        if (record.tPath && fs.existsSync(record.tPath)) {
          const parsed = parseTranscriptFile(record.tPath, record.limit);
          record.panel.webview.postMessage({
            type: 'moreTurnsLoaded',
            turns: parsed.turns,
            totalCount: parsed.totalCount,
            hasEarlier: parsed.hasEarlier,
            session: record.session
          });
        }
      } else if (data.command === 'sendPrompt') {
        const cid = (record.session && record.session.cid) ? record.session.cid : null;
        if (this.sendTextToTmux) {
          this.sendTextToTmux(record.sessionName, data.text, cid);
        }
        // Rapid response checks after prompt
        setTimeout(() => sendTurnsToWebview(false), 500);
        setTimeout(() => sendTurnsToWebview(false), 1200);
        setTimeout(() => sendTurnsToWebview(false), 2500);
        setTimeout(() => sendTurnsToWebview(false), 4500);
      } else if (data.command === 'termActivate') {
        record.isTermActive = true;
        startTermFastPolling();
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
      } else if (data.command === 'openNativeTerminal') {
        const isEditor = data.location === 'editor';
        const loc = isEditor ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel;
        if (this.attachRemoteControl && record.session && record.session.cid) {
          this.attachRemoteControl(record.session.cid, record.session.title, loc);
        } else if (this.attachToSession) {
          this.attachToSession(record.sessionName, loc);
        } else {
          const termName = (record.session && record.session.cid) ? `AGY: ${record.session.title || record.session.cid.slice(0, 8)}` : `tmux: ${record.sessionName}`;
          const existing = vscode.window.terminals.find(t => t.name === termName);
          if (existing) {
            existing.show();
          } else {
            const terminal = vscode.window.createTerminal({
              name: termName,
              shellPath: 'tmux',
              shellArgs: ['attach-session', '-t', record.sessionName],
              location: loc
            });
            terminal.show();
          }
        }
      } else if (data.command === 'termDeactivate') {
        record.isTermActive = false;
        stopTermFastPolling();
      } else if (data.command === 'termCommand') {
        const cmd = data.text;
        if (cmd) {
          if (this.sendTextToTmux) {
            this.sendTextToTmux(record.sessionName, cmd);
          } else {
            try {
              execSync(`tmux send-keys -t "${record.sessionName}" -l ${JSON.stringify(cmd)} 2>/dev/null`);
              execSync(`tmux send-keys -t "${record.sessionName}" Enter 2>/dev/null`);
            } catch (e) {}
          }
          // Instant response: capture immediately at 15ms, 80ms, 250ms
          setTimeout(() => sendTerminalToWebview(false), 15);
          setTimeout(() => sendTerminalToWebview(false), 80);
          setTimeout(() => sendTerminalToWebview(false), 250);
        }
      } else if (data.command === 'termData') {
        try {
          const key = data.data;
          if (key === '\r' || key === '\n') {
            execSync(`tmux send-keys -t "${record.sessionName}" Enter 2>/dev/null`);
          } else if (key === '\x7f' || key === '\b') {
            execSync(`tmux send-keys -t "${record.sessionName}" BSpace 2>/dev/null`);
          } else if (key === '\t') {
            execSync(`tmux send-keys -t "${record.sessionName}" Tab 2>/dev/null`);
          } else if (key === '\x03') {
            execSync(`tmux send-keys -t "${record.sessionName}" C-c 2>/dev/null`);
          } else if (key === '\x04') {
            execSync(`tmux send-keys -t "${record.sessionName}" C-d 2>/dev/null`);
          } else if (key === '\x1b[A') {
            execSync(`tmux send-keys -t "${record.sessionName}" Up 2>/dev/null`);
          } else if (key === '\x1b[B') {
            execSync(`tmux send-keys -t "${record.sessionName}" Down 2>/dev/null`);
          } else if (key === '\x1b[C') {
            execSync(`tmux send-keys -t "${record.sessionName}" Right 2>/dev/null`);
          } else if (key === '\x1b[D') {
            execSync(`tmux send-keys -t "${record.sessionName}" Left 2>/dev/null`);
          } else if (key) {
            execSync(`tmux send-keys -t "${record.sessionName}" -l ${JSON.stringify(key)} 2>/dev/null`);
          }
        } catch (e) {}
        // Instant response: echo keystrokes within 10ms and 50ms
        setTimeout(() => sendTerminalToWebview(false), 10);
        setTimeout(() => sendTerminalToWebview(false), 50);
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
        <button id="tab-native-term" class="tab-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:5px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>내장 터미널</button>
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
        <textarea id="composer-input" placeholder="Ask anything, @ to mention, / for actions... (Shift+Enter 줄바꿈)"></textarea>
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
      <div class="terminal-input-bar">
        <span class="term-prompt-icon">$</span>
        <input id="term-cmd-input" type="text" placeholder="명령어를 입력하세요 (예: git status, top, ls, /clear)..." autocomplete="off" />
        <button id="btn-term-send" class="btn-primary" type="button">실행 ↵</button>
      </div>
    </div>

    <div id="view-native-term" class="view-content">
      <div class="native-term-toolbar">
        <div class="native-term-badge">
          <span class="native-term-pulse-dot"></span>
          <span class="native-term-badge-title">내장 터미널 (현재 창)</span>
          <span class="native-term-badge-session">${displayTitle}</span>
        </div>
        <div class="native-term-actions-inline">
          <button id="btn-open-panel-term" class="btn-tool" type="button" title="하단 패널 터미널로 분리 열기">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="2" y1="12" x2="22" y2="12"></line></svg>하단 패널 분리 ↗
          </button>
          <button id="btn-open-editor-term" class="btn-tool" type="button" title="새 에디터 탭으로 분리 열기">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>에디터 탭 분리 ↗
          </button>
        </div>
      </div>

      <div id="native-terminal-container" class="terminal-container">
        <pre id="native-terminal-output" class="terminal-screen"></pre>
        <button id="btn-native-term-scroll-bottom" class="term-scroll-btn" style="display:none;">⬇ 최신 터미널 출력으로 이동</button>
      </div>

      <div class="terminal-input-bar">
        <span class="term-prompt-icon">$</span>
        <input id="native-term-cmd-input" type="text" placeholder="명령어를 입력하세요 (예: git status, top, ls, /clear)..." autocomplete="off" />
        <button id="btn-native-term-send" class="btn-primary" type="button">실행 ↵</button>
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
