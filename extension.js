const { SessionChatPanelManager } = require('./chat-panel');
const vscode = require('vscode');
const { getCategorizedSessions } = require('./session-discovery');
const { exec, execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DELETE_SESSION_PY = path.join(__dirname, 'delete-session.py');

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getTmuxSessionName(cid) {
  return `rc_${(cid || '').slice(0, 8)}`;
}

function sendTextToTmux(sessionName, text) {
  if (!sessionName || !text) return false;
  const tmpFile = path.join(os.tmpdir(), `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8');
    execSync(`tmux load-buffer "${tmpFile}"`);
    execSync(`tmux paste-buffer -p -t "${sessionName}"`);
    execSync(`tmux send-keys -t "${sessionName}" Enter`);
    return true;
  } catch (err) {
    console.error(`Failed to send text to tmux session ${sessionName}:`, err);
    vscode.window.showErrorMessage(`Failed to send prompt to "${sessionName}": ${err.message}`);
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

function resolveTmuxSessionFromTerminal(terminal, cachedData) {
  if (!terminal) return null;
  const tName = terminal.name || '';
  if (tName.startsWith('tmux: ')) {
    const sessionName = tName.replace('tmux: ', '').trim();
    return {
      sessionName,
      label: sessionName,
      terminal
    };
  }
  if (tName.startsWith('AGY: ')) {
    const raw = tName.replace('AGY: ', '').trim();
    if (cachedData && cachedData.remoteControl) {
      const match = cachedData.remoteControl.find(s => (s.title && s.title.trim() === raw) || (s.cid && s.cid.startsWith(raw)));
      if (match) {
        return {
          sessionName: getTmuxSessionName(match.cid),
          label: `[${match.cid.slice(0, 4)}] ${match.title || raw}`,
          cid: match.cid,
          terminal
        };
      }
    }
    return {
      sessionName: `rc_${raw.slice(0, 8)}`,
      label: tName,
      terminal
    };
  }
  return null;
}

class CategoryItem extends vscode.TreeItem {
  constructor(label, key, count, expanded = false) {
    super(
      `${label} (${count})`,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.key = key;
    this.contextValue = 'categoryItem';

    if (key === 'remoteControl') {
      this.iconPath = new vscode.ThemeIcon('cloud');
    } else if (key === 'agy') {
      this.iconPath = new vscode.ThemeIcon('sparkle');
    } else if (key === 'claude') {
      this.iconPath = new vscode.ThemeIcon('hubot');
    } else if (key === 'codex') {
      this.iconPath = new vscode.ThemeIcon('code');
    } else {
      this.iconPath = new vscode.ThemeIcon('terminal');
    }
  }
}

class RemoteControlItem extends vscode.TreeItem {
  constructor(session) {
    const shortCid = (session.cid || '').slice(0, 4);
    super(`${session.title || 'Unnamed Session'} [${shortCid}]`, vscode.TreeItemCollapsibleState.None);
    this.session = session;
    this.description = `${session.time_str} • ${session.steps} steps`;

    const lines = [
      `Title: ${session.title}`,
      `Conversation ID: ${session.cid}`,
      `Last Modified: ${session.time_str}`,
      `Total Steps: ${session.steps}`,
      `Database Size: ${session.size_kb} KB`,
      '',
      '🖱️ 항목 클릭: 통합 AI 대화창 & 콘솔 터미널 열기',
      '',
      '【우측 아이콘 액션 버튼】',
      '💬 프롬프트 전송 (간편 입력)',
      '🔄 최신 대화 동기화',
      '🗑️ 세션 삭제'
    ];
    this.tooltip = lines.join('\n');
    this.contextValue = 'remoteControlItem';
    this.iconPath = new vscode.ThemeIcon('radio-tower');

    this.command = {
      command: 'sessionManager.openSessionPanel',
      title: 'Open AI Session',
      arguments: [session]
    };
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(session, type) {
    super(session.name, vscode.TreeItemCollapsibleState.None);
    this.session = session;
    this.type = type;

    const isInactive = session.cmd === 'bash' || session.cmd === 'sh';
    if (isInactive) {
      this.description = `[inactive / shell] PID ${session.pid}`;
    } else if (session.title) {
      this.description = `${session.title} (${session.cmd || 'idle'})`;
    } else {
      this.description = `PID ${session.pid} [${session.cmd || 'idle'}]`;
    }

    const lines = [
      `Session: ${session.name}`,
      `Command: ${session.cmd} (PID: ${session.pid})`
    ];
    if (isInactive) {
      lines.push('⚠️ Inactive session (at shell prompt). For active agent sessions, use Remote Control Sessions above.');
    }
    if (session.title) {
      lines.push(`Title: ${session.title}`);
    }
    if (session.cid) {
      lines.push(`Conversation ID: ${session.cid}`);
    }
    lines.push('');
    lines.push('🖱️ 항목 클릭: 통합 AI 대화창 & 콘솔 터미널 열기');
    lines.push('');
    lines.push('【우측 아이콘 액션 버튼】');
    lines.push('💬 프롬프트 전송');
    lines.push('>_ 터미널 연결');
    lines.push('🗑️ 세션 종료');
    this.tooltip = lines.join('\n');

    this.contextValue = 'sessionItem';

    if (type === 'agy') {
      this.iconPath = isInactive ? new vscode.ThemeIcon('terminal') : new vscode.ThemeIcon('sparkle');
    } else if (type === 'claude') {
      this.iconPath = new vscode.ThemeIcon('terminal-view-icon');
    } else if (type === 'codex') {
      this.iconPath = new vscode.ThemeIcon('symbol-property');
    } else {
      this.iconPath = new vscode.ThemeIcon('terminal');
    }

    this.command = {
      command: 'sessionManager.openSessionPanel',
      title: 'Open Session Panel',
      arguments: [session]
    };
  }
}

class SessionTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.cachedData = { remoteControl: [], agy: [], claude: [], codex: [], other: [] };
    this.lastDataHash = '';
    this.onDataRefreshedCallbacks = [];
  }

  onDataRefreshed(cb) {
    this.onDataRefreshedCallbacks.push(cb);
  }

  async smartRefresh(force = false) {
    try {
      const freshData = await getCategorizedSessions();
      const newHash = JSON.stringify({
        rc: (freshData.remoteControl || []).map(s => `${s.cid}:${s.steps}:${s.mtime}`),
        agy: (freshData.agy || []).map(s => `${s.name}:${s.cmd}:${s.pid}`),
        claude: (freshData.claude || []).map(s => s.name),
        codex: (freshData.codex || []).map(s => s.name),
        other: (freshData.other || []).map(s => s.name)
      });

      if (force || newHash !== this.lastDataHash) {
        this.cachedData = freshData;
        this.lastDataHash = newHash;
        this._onDidChangeTreeData.fire();
        for (const cb of this.onDataRefreshedCallbacks) {
          try { cb(freshData); } catch (e) {}
        }
      }
    } catch (e) {
      console.error('Error in smartRefresh:', e);
    }
  }

  refresh() {
    this.smartRefresh(true);
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      if (!this.lastDataHash) {
        try {
          this.cachedData = await getCategorizedSessions();
        } catch (e) {
          console.error('Error fetching sessions:', e);
        }
      }

      const categories = [];
      if (this.cachedData.remoteControl && this.cachedData.remoteControl.length > 0) {
        categories.push(new CategoryItem('Remote Control Sessions (Antigravity Hub)', 'remoteControl', this.cachedData.remoteControl.length, true));
      }
      if (this.cachedData.agy && this.cachedData.agy.length > 0) {
        categories.push(new CategoryItem('Active tmux Sessions (agy_*)', 'agy', this.cachedData.agy.length, false));
      }
      if (this.cachedData.claude && this.cachedData.claude.length > 0) {
        categories.push(new CategoryItem('Claude Code Sessions (tmux)', 'claude', this.cachedData.claude.length, false));
      }
      if (this.cachedData.codex && this.cachedData.codex.length > 0) {
        categories.push(new CategoryItem('Codex Sessions (tmux)', 'codex', this.cachedData.codex.length, false));
      }
      if (this.cachedData.other && this.cachedData.other.length > 0) {
        categories.push(new CategoryItem('Other tmux Sessions', 'other', this.cachedData.other.length, false));
      }

      if (categories.length === 0) {
        const emptyItem = new vscode.TreeItem('No active sessions found');
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        return [emptyItem];
      }
      return categories;
    }

    if (element instanceof CategoryItem) {
      if (element.key === 'remoteControl') {
        const list = this.cachedData.remoteControl || [];
        return list.map(s => new RemoteControlItem(s));
      }
      const list = this.cachedData[element.key] || [];
      return list.map(s => new SessionItem(s, element.key));
    }

    return [];
  }
}

function attachToSession(sessionName) {
  if (!sessionName) return;
  const terminalName = `tmux: ${sessionName}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return existing;
  }

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['attach-session', '-t', sessionName]
  });
  terminal.show();
  return terminal;
}

function attachRemoteControl(cid, title) {
  if (!cid) return;
  const terminalName = `AGY: ${title || cid.slice(0, 8)}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return existing;
  }

  const tmuxSessionName = getTmuxSessionName(cid);

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['new-session', '-A', '-s', tmuxSessionName, `agy --conversation=${cid}`]
  });
  terminal.show();
  return terminal;
}

function reloadRemoteControl(cid, title) {
  if (!cid) return;
  const terminalName = `AGY: ${title || cid.slice(0, 8)}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.dispose();
  }

  const tmuxSessionName = getTmuxSessionName(cid);

  try {
    execSync(`tmux kill-session -t "${tmuxSessionName}" 2>/dev/null || true`);
  } catch (e) {}

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['new-session', '-A', '-s', tmuxSessionName, `agy --conversation=${cid}`]
  });
  terminal.show();
  vscode.window.showInformationMessage(`Reloaded session "${title || cid.slice(0, 8)}" with latest turns.`);
}

async function deleteRemoteControl(cid, title, treeDataProvider) {
  if (!cid) return;
  const shortCid = cid.slice(0, 4);
  const displayTitle = title || cid.slice(0, 8);

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to delete session "${displayTitle}" [${shortCid}]?\n\nImpact & Blast Radius:\n• Conversation history and DB records will be permanently removed from Antigravity Hub and server.\n• Workspace source files and git commits will NOT be affected.`,
    { modal: true },
    'Delete Session'
  );

  if (confirm !== 'Delete Session') {
    return;
  }

  const terminalName = `AGY: ${displayTitle}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.dispose();
  }

  const tmuxSessionName = getTmuxSessionName(cid);
  try {
    execSync(`tmux kill-session -t "${tmuxSessionName}" 2>/dev/null || true`);
  } catch (e) {}

  try {
    if (fs.existsSync(DELETE_SESSION_PY)) {
      execFileSync('python3', [DELETE_SESSION_PY, cid], { encoding: 'utf-8', timeout: 5000 });
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to delete session files: ${err.message}`);
    return;
  }

  vscode.window.showInformationMessage(`Session "${displayTitle}" [${shortCid}] deleted successfully.`);
  if (treeDataProvider) {
    treeDataProvider.refresh();
  }
}

class PromptComposerViewProvider {
  constructor(extensionUri, treeDataProvider) {
    this._extensionUri = extensionUri;
    this.treeDataProvider = treeDataProvider;
    this._view = undefined;
  }

  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.command === 'sendPrompt') {
        await this._handleSendPrompt(data.text, data.target);
      } else if (data.command === 'requestSessions') {
        this.updateSessions(this.treeDataProvider.cachedData);
        this.syncActiveTerminal(vscode.window.activeTerminal);
      }
    });

    // Send initial session data
    this.updateSessions(this.treeDataProvider.cachedData);
    this.syncActiveTerminal(vscode.window.activeTerminal);
  }

  updateSessions(cachedData) {
    if (!this._view || !cachedData) return;
    this._view.webview.postMessage({
      type: 'updateSessions',
      remoteControl: cachedData.remoteControl || [],
      agy: cachedData.agy || [],
      other: cachedData.other || []
    });
  }

  syncActiveTerminal(terminal) {
    if (!this._view) return;
    const res = resolveTmuxSessionFromTerminal(terminal, this.treeDataProvider.cachedData);
    if (res) {
      this._view.webview.postMessage({
        type: 'syncActiveSession',
        label: res.label,
        sessionName: res.sessionName
      });
    } else {
      this._view.webview.postMessage({
        type: 'syncActiveSession',
        label: terminal ? terminal.name : '선택 필요',
        sessionName: null
      });
    }
  }

  focus() {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: 'focusInput' });
    }
  }

  async _handleSendPrompt(text, targetVal) {
    if (!text || !text.trim()) return;

    let targetSession = null;
    let targetLabel = null;

    if (!targetVal || targetVal === '__active__') {
      const res = resolveTmuxSessionFromTerminal(vscode.window.activeTerminal, this.treeDataProvider.cachedData);
      if (res) {
        targetSession = res.sessionName;
        targetLabel = res.label;
      } else {
        // Fall back to first available session
        const rc = this.treeDataProvider.cachedData.remoteControl;
        const agy = this.treeDataProvider.cachedData.agy;
        if (rc && rc.length > 0) {
          targetSession = getTmuxSessionName(rc[0].cid);
          targetLabel = `[${rc[0].cid.slice(0, 4)}] ${rc[0].title || rc[0].cid}`;
          attachRemoteControl(rc[0].cid, rc[0].title);
        } else if (agy && agy.length > 0) {
          targetSession = agy[0].name;
          targetLabel = agy[0].name;
          attachToSession(targetSession);
        }
      }
    } else if (targetVal.startsWith('rc:')) {
      const cid = targetVal.slice(3);
      targetSession = getTmuxSessionName(cid);
      const match = (this.treeDataProvider.cachedData.remoteControl || []).find(s => s.cid === cid);
      targetLabel = match ? `[${cid.slice(0, 4)}] ${match.title}` : targetSession;
      attachRemoteControl(cid, match ? match.title : null);
    } else if (targetVal.startsWith('tmux:')) {
      targetSession = targetVal.slice(5);
      targetLabel = targetSession;
      attachToSession(targetSession);
    }

    if (!targetSession) {
      vscode.window.showWarningMessage('활성화된 세션을 찾을 수 없습니다. 세션을 먼저 선택하거나 열어주세요.');
      return;
    }

    const success = sendTextToTmux(targetSession, text);
    if (success) {
      vscode.window.setStatusBarMessage(`$(check) 프롬프트 전송됨: ${targetLabel}`, 3000);
    }
  }

  _getHtmlForWebview(webview) {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <style>
    :root {
      --input-bg: var(--vscode-input-background, #1e1e1e);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --focus-border: var(--vscode-focusBorder, #007fd4);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --sec-btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --sec-btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --sec-btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --desc-fg: var(--vscode-descriptionForeground, #8c8c8c);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      --editor-font: var(--vscode-editor-font-family, 'D2Coding', 'Cascadia Mono', Consolas, monospace);
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      padding: 8px 10px;
      font-family: var(--font-family);
      font-size: 13px;
      color: var(--input-fg);
      background-color: transparent;
      overflow-x: hidden;
    }
    .composer-header {
      margin-bottom: 8px;
    }
    .target-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .target-label {
      color: var(--desc-fg);
      white-space: nowrap;
      font-weight: 500;
    }
    .session-select {
      flex: 1;
      min-width: 0;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 12px;
      outline: none;
      cursor: pointer;
    }
    .session-select:focus {
      border-color: var(--focus-border);
    }
    .composer-box {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--input-border);
      border-radius: 6px;
      background: var(--input-bg);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .composer-box:focus-within {
      border-color: var(--focus-border);
      box-shadow: 0 0 0 1px var(--focus-border);
    }
    textarea {
      width: 100%;
      min-height: 80px;
      max-height: 240px;
      padding: 8px 10px;
      background: transparent;
      color: var(--input-fg);
      border: none;
      outline: none;
      resize: none;
      font-family: var(--editor-font);
      font-size: 13px;
      line-height: 1.45;
    }
    textarea::placeholder {
      color: var(--desc-fg);
      font-family: var(--font-family);
      font-size: 12px;
      opacity: 0.75;
    }
    .composer-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(0, 0, 0, 0.15);
      border-bottom-left-radius: 6px;
      border-bottom-right-radius: 6px;
    }
    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--desc-fg);
      user-select: none;
      cursor: pointer;
    }
    .toggle-wrap input {
      cursor: pointer;
      accent-color: var(--focus-border);
    }
    .btn-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      outline: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    button:active {
      transform: scale(0.98);
    }
    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .btn-primary:hover {
      background: var(--btn-hover);
    }
    .btn-secondary {
      background: var(--sec-btn-bg);
      color: var(--sec-btn-fg);
    }
    .btn-secondary:hover {
      background: var(--sec-btn-hover);
    }
    .status-toast {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      color: #4ade80;
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
      display: inline-block;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .status-toast.show {
      opacity: 1;
    }
    .hint-bar {
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--desc-fg);
    }
    .hint-bar kbd {
      background: rgba(255, 255, 255, 0.1);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
    }
    .history-drawer {
      margin-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 6px;
    }
    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--desc-fg);
      cursor: pointer;
      padding: 2px 0;
      user-select: none;
    }
    .history-list {
      display: none;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
      max-height: 120px;
      overflow-y: auto;
    }
    .history-item {
      padding: 4px 8px;
      font-size: 11px;
      font-family: var(--editor-font);
      background: rgba(255, 255, 255, 0.03);
      border-radius: 4px;
      color: var(--input-fg);
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .history-item:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--focus-border);
    }
  </style>
</head>
<body>
  <div class="composer-header">
    <div class="target-bar">
      <span class="target-label">🎯 대상:</span>
      <select id="session-select" class="session-select">
        <option value="__active__">⚡ [자동] 현재 활성 터미널</option>
      </select>
    </div>
  </div>

  <div class="composer-box">
    <textarea id="prompt-textarea" placeholder="이 창과 동일하게 마우스 드래그 선택/삭제, Shift+방향키, Ctrl+C/V/X 모두 지원됩니다..."></textarea>
    <div class="composer-footer">
      <label class="toggle-wrap" title="Enter 키를 누르면 바로 세션으로 전송합니다. Shift+Enter로 줄바꿈합니다.">
        <input type="checkbox" id="enter-send-toggle" checked />
        <span>Enter 전송</span>
      </label>
      <div class="btn-group">
        <button id="clear-btn" class="btn-secondary" title="텍스트 지우기">지우기</button>
        <button id="send-btn" class="btn-primary" title="세션으로 전송">전송 🚀</button>
      </div>
    </div>
  </div>

  <div class="hint-bar">
    <span>단축키: <kbd>Alt+I</kbd> 퀵 다이얼로그</span>
    <div id="status-toast" class="status-toast">✓ 전송 완료</div>
  </div>

  <div class="history-drawer">
    <div class="history-header" id="history-toggle">
      <span>🕒 최근 입력 내역</span>
      <span id="history-arrow">▾</span>
    </div>
    <div id="history-list" class="history-list"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('prompt-textarea');
    const select = document.getElementById('session-select');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const enterToggle = document.getElementById('enter-send-toggle');
    const toast = document.getElementById('status-toast');
    const historyList = document.getElementById('history-list');
    const historyToggle = document.getElementById('history-toggle');
    const historyArrow = document.getElementById('history-arrow');

    let history = [];
    let historyIndex = -1;
    let savedState = vscode.getState() || {};
    if (savedState.history) history = savedState.history;
    if (savedState.enterToSend !== undefined) enterToggle.checked = savedState.enterToSend;

    function renderHistory() {
      historyList.innerHTML = '';
      if (history.length === 0) {
        historyList.innerHTML = '<div style="color:var(--desc-fg);font-size:11px;padding:4px;">최근 전송 내역이 없습니다.</div>';
        return;
      }
      history.slice(0, 5).forEach((itemText) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.textContent = itemText;
        div.title = itemText;
        div.onclick = () => {
          textarea.value = itemText;
          autoResize();
          textarea.focus();
        };
        historyList.appendChild(div);
      });
    }

    let historyOpen = false;
    historyToggle.onclick = () => {
      historyOpen = !historyOpen;
      historyList.style.display = historyOpen ? 'flex' : 'none';
      historyArrow.textContent = historyOpen ? '▴' : '▾';
    };

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(80, Math.min(textarea.scrollHeight, 240)) + 'px';
    }

    textarea.addEventListener('input', () => {
      autoResize();
      historyIndex = -1;
    });

    enterToggle.addEventListener('change', () => {
      vscode.setState({ ...vscode.getState(), enterToSend: enterToggle.checked });
    });

    function showToast(msg) {
      toast.textContent = msg || '✓ 전송 완료';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function doSend() {
      const text = textarea.value.trim();
      if (!text) return;

      const targetVal = select.value;
      vscode.postMessage({
        command: 'sendPrompt',
        text: text,
        target: targetVal
      });

      history = [text, ...history.filter(h => h !== text)].slice(0, 20);
      historyIndex = -1;
      vscode.setState({ ...vscode.getState(), history });
      renderHistory();

      textarea.value = '';
      autoResize();
      showToast('✓ 세션으로 전송 완료');
      textarea.focus();
    }

    sendBtn.onclick = doSend;
    clearBtn.onclick = () => {
      textarea.value = '';
      autoResize();
      textarea.focus();
    };

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (enterToggle.checked) {
          if (!e.shiftKey) {
            e.preventDefault();
            doSend();
          }
        } else {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            doSend();
          }
        }
      } else if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.value === '') {
        if (history.length > 0) {
          e.preventDefault();
          historyIndex = Math.min(historyIndex + 1, history.length - 1);
          textarea.value = history[historyIndex];
          autoResize();
        }
      } else if (e.key === 'ArrowDown' && historyIndex >= 0) {
        e.preventDefault();
        historyIndex = Math.max(-1, historyIndex - 1);
        textarea.value = historyIndex >= 0 ? history[historyIndex] : '';
        autoResize();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateSessions') {
        const currentVal = select.value;
        select.innerHTML = '<option value="__active__">⚡ [자동] 현재 활성 터미널</option>';

        if (msg.remoteControl && msg.remoteControl.length > 0) {
          const group = document.createElement('optgroup');
          group.label = 'Remote Control (AGY) Sessions';
          msg.remoteControl.forEach(s => {
            const opt = document.createElement('option');
            opt.value = 'rc:' + s.cid;
            opt.textContent = '[' + s.cid.slice(0, 4) + '] ' + (s.title || 'AGY Session');
            group.appendChild(opt);
          });
          select.appendChild(group);
        }

        if (msg.agy && msg.agy.length > 0) {
          const group = document.createElement('optgroup');
          group.label = 'Active tmux Sessions (agy_*)';
          msg.agy.forEach(s => {
            const opt = document.createElement('option');
            opt.value = 'tmux:' + s.name;
            opt.textContent = s.name + (s.title ? ' (' + s.title + ')' : '');
            group.appendChild(opt);
          });
          select.appendChild(group);
        }

        if (msg.other && msg.other.length > 0) {
          const group = document.createElement('optgroup');
          group.label = 'Other tmux Sessions';
          msg.other.forEach(s => {
            const opt = document.createElement('option');
            opt.value = 'tmux:' + s.name;
            opt.textContent = s.name + ' (' + (s.cmd || 'idle') + ')';
            group.appendChild(opt);
          });
          select.appendChild(group);
        }

        const exists = Array.from(select.options).some(o => o.value === currentVal);
        if (exists) {
          select.value = currentVal;
        }
      } else if (msg.type === 'syncActiveSession') {
        const activeOpt = select.options[0];
        if (activeOpt) {
          activeOpt.textContent = '⚡ [자동] 현재: ' + (msg.label || '활성 터미널');
        }
      } else if (msg.type === 'focusInput') {
        textarea.focus();
      }
    });

    renderHistory();
    vscode.postMessage({ command: 'requestSessions' });
  </script>
</body>
</html>`;
  }
}

async function handleQuickPrompt(arg, treeDataProvider) {
  let targetSession = null;
  let targetTitle = null;

  if (arg && arg.session) {
    if (arg.contextValue === 'remoteControlItem') {
      targetSession = getTmuxSessionName(arg.session.cid);
      targetTitle = `[${arg.session.cid.slice(0, 4)}] ${arg.session.title}`;
      attachRemoteControl(arg.session.cid, arg.session.title);
    } else {
      targetSession = arg.session.name;
      targetTitle = targetSession;
      attachToSession(targetSession);
    }
  } else if (typeof arg === 'string') {
    targetSession = arg;
    targetTitle = arg;
  } else {
    // Resolve from active terminal
    const res = resolveTmuxSessionFromTerminal(vscode.window.activeTerminal, treeDataProvider.cachedData);
    if (res) {
      targetSession = res.sessionName;
      targetTitle = res.label;
    } else {
      // Show quickpick
      const items = [];
      const rcList = treeDataProvider.cachedData.remoteControl || [];
      const agyList = treeDataProvider.cachedData.agy || [];
      const otherList = treeDataProvider.cachedData.other || [];

      for (const s of rcList) {
        items.push({
          label: `$(radio-tower) [${s.cid.slice(0, 4)}] ${s.title}`,
          description: s.time_str,
          sessionName: getTmuxSessionName(s.cid),
          cid: s.cid,
          title: s.title
        });
      }
      for (const s of agyList) {
        items.push({
          label: `$(sparkle) ${s.name}`,
          description: s.title || s.cmd,
          sessionName: s.name
        });
      }
      for (const s of otherList) {
        items.push({
          label: `$(terminal) ${s.name}`,
          description: s.cmd,
          sessionName: s.name
        });
      }

      if (items.length === 0) {
        vscode.window.showWarningMessage('실행 중인 세션을 찾을 수 없습니다.');
        return;
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: '프롬프트를 전송할 세션을 선택하세요'
      });
      if (!picked) return;

      targetSession = picked.sessionName;
      targetTitle = picked.label.replace(/^\$\([^)]+\)\s*/, '');
      if (picked.cid) {
        attachRemoteControl(picked.cid, picked.title);
      } else {
        attachToSession(targetSession);
      }
    }
  }

  if (!targetSession) return;

  const input = await vscode.window.showInputBox({
    title: `💬 [${targetTitle}] 프롬프트 전송 (동일 입력창 방식)`,
    prompt: '마우스 드래그 선택/삭제, Shift+방향키, Ctrl+C/V/X 지원. Enter를 누르면 세션으로 전송됩니다.',
    placeHolder: '프롬프트 입력...'
  });

  if (input && input.trim()) {
    const ok = sendTextToTmux(targetSession, input.trim());
    if (ok) {
      vscode.window.setStatusBarMessage(`$(check) 프롬프트 전송됨: ${targetTitle}`, 3000);
    }
  }
}

function activate(context) {
  try {
    exec('tmux set -g mouse on 2>/dev/null || true');
    exec('tmux set -g history-limit 50000 2>/dev/null || true');
  } catch (e) {}

  console.log('Session Manager extension is now active!');

  const treeDataProvider = new SessionTreeDataProvider();
  vscode.window.registerTreeDataProvider('sessionManagerView', treeDataProvider);

  // Initialize SessionChatPanelManager for rich AI chat & terminal editor tabs
  const panelManager = new SessionChatPanelManager(context.extensionUri, context.subscriptions, sendTextToTmux);
  const openPanelCmd = vscode.commands.registerCommand('sessionManager.openSessionPanel', (session) => {
    panelManager.openOrRevealPanel(vscode, session);
  });

  // Register Webview View Provider for Prompt Composer
  const composerProvider = new PromptComposerViewProvider(context.extensionUri, treeDataProvider);
  const composerViewReg = vscode.window.registerWebviewViewProvider(
    'sessionPromptComposerView',
    composerProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // Sync composer when data refreshes
  treeDataProvider.onDataRefreshed((freshData) => {
    composerProvider.updateSessions(freshData);
    composerProvider.syncActiveTerminal(vscode.window.activeTerminal);
  });

  // Track terminal focus changes to automatically sync active session target
  const terminalChangeSub = vscode.window.onDidChangeActiveTerminal((term) => {
    composerProvider.syncActiveTerminal(term);
  });

  // Initial load
  treeDataProvider.smartRefresh(true);

  const attachCmd = vscode.commands.registerCommand('sessionManager.attach', (arg) => {
    let sessionName = arg;
    if (arg && arg.session && arg.session.name) {
      sessionName = arg.session.name;
    }
    attachToSession(sessionName);
  });

  const attachRcCmd = vscode.commands.registerCommand('sessionManager.attachRemoteControl', (cid, title) => {
    attachRemoteControl(cid, title);
  });

  const reloadRcCmd = vscode.commands.registerCommand('sessionManager.reloadRemoteControl', (arg) => {
    let cid, title;
    if (arg && arg.session) {
      cid = arg.session.cid;
      title = arg.session.title;
    } else if (typeof arg === 'string') {
      cid = arg;
    }
    if (cid) {
      reloadRemoteControl(cid, title);
    }
  });

  const deleteRcCmd = vscode.commands.registerCommand('sessionManager.deleteRemoteControl', async (arg) => {
    let cid, title;
    if (arg && arg.session) {
      cid = arg.session.cid;
      title = arg.session.title;
    } else if (typeof arg === 'string') {
      cid = arg;
    }
    if (cid) {
      await deleteRemoteControl(cid, title, treeDataProvider);
    }
  });

  const refreshCmd = vscode.commands.registerCommand('sessionManager.refresh', () => {
    treeDataProvider.refresh();
  });

  const newAgyCmd = vscode.commands.registerCommand('sessionManager.newAgy', async () => {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter name for new AGY session (e.g. music_tagger, investment_review)',
      placeHolder: 'session_name'
    });
    if (!input) return;

    const safeName = input.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const sessionName = `agy_${safeName}`;

    exec(`tmux new-session -d -s "${sessionName}" "agy"`, (err) => {
      if (err) {
        vscode.window.showErrorMessage(`Failed to create tmux session: ${err.message}`);
        return;
      }
      treeDataProvider.refresh();
      setTimeout(() => {
        attachToSession(sessionName);
      }, 500);
    });
  });

  const killCmd = vscode.commands.registerCommand('sessionManager.kill', async (arg) => {
    let sessionName = arg;
    if (arg && arg.session && arg.session.name) {
      sessionName = arg.session.name;
    }
    if (!sessionName) return;

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to kill tmux session "${sessionName}"?`,
      { modal: true },
      'Kill Session'
    );
    if (confirm === 'Kill Session') {
      exec(`tmux kill-session -t "${sessionName}"`, (err) => {
        if (err) {
          vscode.window.showErrorMessage(`Failed to kill session: ${err.message}`);
        } else {
          vscode.window.showInformationMessage(`Session "${sessionName}" killed.`);
          treeDataProvider.refresh();
        }
      });
    }
  });

  const sendPromptCmd = vscode.commands.registerCommand('sessionManager.sendPrompt', async (arg) => {
    await handleQuickPrompt(arg, treeDataProvider);
  });

  const focusComposerCmd = vscode.commands.registerCommand('sessionManager.focusComposer', () => {
    composerProvider.focus();
  });

  const interval = setInterval(() => {
    treeDataProvider.smartRefresh(false);
  }, 4000);

  const homeDir = process.env.HOME || '/home/ttolmany';
  const transcriptWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-ide/brain'), '*/.system_generated/logs/transcript.jsonl')
  );
  transcriptWatcher.onDidChange((uri) => {
    const parts = uri.fsPath.split(path.sep);
    const brainIdx = parts.indexOf('brain');
    if (brainIdx !== -1 && parts[brainIdx + 1]) {
      panelManager.syncTranscript(parts[brainIdx + 1]);
    }
  });
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-cli'), 'conversation_summaries.db*')
  );
  watcher.onDidChange(() => treeDataProvider.smartRefresh(false));
  watcher.onDidCreate(() => treeDataProvider.smartRefresh(false));

  context.subscriptions.push(
    openPanelCmd, attachCmd, attachRcCmd, reloadRcCmd, deleteRcCmd, refreshCmd, newAgyCmd, killCmd,
    sendPromptCmd, focusComposerCmd,
    composerViewReg, terminalChangeSub,
    watcher, transcriptWatcher,
    { dispose: () => clearInterval(interval) }
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
