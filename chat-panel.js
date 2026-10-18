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

function getTranscriptPath(cid) {
  const home = process.env.HOME || '/home/ttolmany';
  return path.join(home, '.gemini/antigravity-ide/brain', cid, '.system_generated/logs/transcript.jsonl');
}

class SessionChatPanelManager {
  constructor(extensionUri, subscriptions, sendTextToTmuxFn) {
    this.extensionUri = extensionUri;
    this.subscriptions = subscriptions;
    this.sendTextToTmux = sendTextToTmuxFn;
    this.panels = new Map(); // key -> WebviewPanel
  }

  syncTranscript(cid) {
    const key = `rc_${cid.slice(0, 8)}`;
    const panel = this.panels.get(key);
    if (panel) {
      const tPath = getTranscriptPath(cid);
      const parsed = parseTranscriptFile(tPath, 40);
      panel.webview.postMessage({
        type: 'initTurns',
        turns: parsed.turns,
        totalCount: parsed.totalCount,
        hasEarlier: parsed.hasEarlier
      });
    }
  }

  openOrRevealPanel(vscode, session) {
    const key = getPanelKey(session);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(vscode.ViewColumn.One);
      return existing;
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

    this.panels.set(key, panel);

    panel.onDidDispose(() => {
      this.panels.delete(key);
    }, null, this.subscriptions);

    panel.webview.html = this.getHtmlForWebview(panel.webview, session, title);

    panel.webview.onDidReceiveMessage((data) => {
      let sessionName = session.cid ? `rc_${session.cid.slice(0, 8)}` : session.name;

      if (data.command === 'sendPrompt') {
        if (this.sendTextToTmux) {
          this.sendTextToTmux(sessionName, data.text);
        }
      } else if (data.command === 'syncTurns') {
        if (session.cid) {
          const tPath = getTranscriptPath(session.cid);
          const parsed = parseTranscriptFile(tPath, 40);
          panel.webview.postMessage({
            type: 'initTurns',
            turns: parsed.turns,
            totalCount: parsed.totalCount,
            hasEarlier: parsed.hasEarlier,
            session
          });
        }
      } else if (data.command === 'termActivate') {
        try {
          const pane = execSync(`tmux capture-pane -p -t "${sessionName}" 2>/dev/null`, { encoding: 'utf-8' });
          panel.webview.postMessage({ type: 'termInit', data: pane });
        } catch (e) {}
      } else if (data.command === 'termData') {
        try {
          execSync(`tmux send-keys -t "${sessionName}" -l ${JSON.stringify(data.data)} 2>/dev/null`);
        } catch (e) {}
      }
    });

    if (session.cid) {
      const tPath = getTranscriptPath(session.cid);
      const parsed = parseTranscriptFile(tPath, 40);
      panel.webview.postMessage({
        type: 'initTurns',
        turns: parsed.turns,
        totalCount: parsed.totalCount,
        hasEarlier: parsed.hasEarlier,
        session
      });
    }

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
        <span class="header-title">${displayTitle}</span>
      </div>
      <div class="tab-switcher">
        <button id="tab-chat" class="tab-btn active">💬 AI 대화창</button>
        <button id="tab-term" class="tab-btn">💻 콘솔 터미널</button>
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
        <pre id="terminal-output" style="color:#f4f4f5;font-family:var(--editor-font);font-size:12px;line-height:1.4;white-space:pre-wrap;height:100%;overflow-y:auto;"></pre>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${webview.asWebviewUri(this.extensionUri)}/media/chat.js"></script>
</body>
</html>`;
  }
}

module.exports = {
  getNonce,
  getPanelKey,
  getTranscriptPath,
  SessionChatPanelManager
};
