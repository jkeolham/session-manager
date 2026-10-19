const { SessionChatPanelManager, resolveTranscriptPath } = require('./chat-panel');
const { parseTranscriptFile } = require('./transcript-parser');
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

async function sendTextToTmux(sessionName, text, cid = null) {
  if (!sessionName || !text) return false;

  // 1. If it's an Antigravity/RemoteControl session, route via local session-manager API Bridge for 100% cloud sync
  const isAgy = Boolean(
    (cid && cid.length > 10) ||
    sessionName.startsWith('rc_') ||
    sessionName.startsWith('agy_')
  );

  if (isAgy) {
    const daemonOwned = Boolean(cid && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(cid));
    try {
      const payload = { session: sessionName, text };
      if (cid) payload.cid = cid;
      const res = await fetch('http://127.0.0.1:8789/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        return true;
      }
      if (daemonOwned) {
        const body = await res.json().catch(() => ({}));
        vscode.window.showErrorMessage(`Prompt not sent: ${body.error || res.status}`);
        return false;
      }
    } catch (e) {
      if (daemonOwned) {
        vscode.window.showErrorMessage(`Prompt not sent — session manager (:8789) unreachable: ${e.message}`);
        return false;
      }
      console.warn(`[SessionManager] API bridge send failed, falling back to tmux:`, e.message);
    }
    // Daemon-owned conversations never fall back to tmux: typing into a TUI of
    // the same conversation starts a second copy the dashboard never sees.
  }

  // 2. Fallback to legacy tmux paste-buffer for Claude, Codex, shell sessions
  const tmpFile = path.join(os.tmpdir(), `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8');
    // 1. Cancel copy-mode in tmux so input reaches the application process!
    execSync(`tmux send-keys -t "${sessionName}" -X cancel 2>/dev/null || true`);
    // 2. Load buffer and paste without -p
    execSync(`tmux load-buffer "${tmpFile}"`);
    execSync(`tmux paste-buffer -t "${sessionName}"`);
    // 3. Small flush delay
    execSync(`sleep 0.05`);
    // 4. Send Enter to submit
    execSync(`tmux send-keys -t "${sessionName}" C-m`);
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
    const label = session.displayName || session.name;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.session = session;
    this.type = type;

    const isInactive = session.cmd === 'bash' || session.cmd === 'sh';
    if (isInactive) {
      this.description = `[inactive / shell] PID ${session.pid}`;
    } else if (session.displayName) {
      this.description = `${session.name} • ${session.cmd || 'active'}`;
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
        categories.push(new CategoryItem('Active Antigravity Sessions (agy_*, rc_*)', 'agy', this.cachedData.agy.length, false));
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

function attachToSession(sessionName, location) {
  if (!sessionName) return;
  const terminalName = `tmux: ${sessionName}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return existing;
  }

  const options = {
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['attach-session', '-t', sessionName]
  };
  if (location) {
    options.location = location;
  }
  const terminal = vscode.window.createTerminal(options);
  terminal.show();
  return terminal;
}

// Antigravity conversations live in the remote-control daemon, so "opening" one
// shows the chat panel (transcript + send via the daemon bridge) instead of
// starting an `agy --conversation` TUI, which would run a second copy of it.
function attachRemoteControl(cid, title) {
  if (!cid) return;
  vscode.commands.executeCommand('sessionManager.openSessionPanel', { cid, title, name: getTmuxSessionName(cid) });
}

function reloadRemoteControl(cid, title) {
  attachRemoteControl(cid, title);
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
    this._currentTarget = '__active__';
    this._currentSessionName = null;
    this._currentCid = null;
    this._tPath = null;
    this._lastMtime = 0;
    this._pollTimer = null;
  }

  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri, vscode.Uri.joinPath(this._extensionUri, 'media')]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (this._view && this._view.visible) {
        this._syncCurrentSessionTurns(false);
      }
    }, 1200);

    webviewView.onDidDispose(() => {
      if (this._pollTimer) clearInterval(this._pollTimer);
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.command === 'sendPrompt') {
        await this._handleSendPrompt(data.text, data.target);
        setTimeout(() => this._syncCurrentSessionTurns(false), 500);
        setTimeout(() => this._syncCurrentSessionTurns(false), 1200);
        setTimeout(() => this._syncCurrentSessionTurns(false), 2500);
        setTimeout(() => this._syncCurrentSessionTurns(false), 4500);
      } else if (data.command === 'requestSessions') {
        this.updateSessions(this.treeDataProvider.cachedData);
        this.syncActiveTerminal(vscode.window.activeTerminal);
      } else if (data.command === 'selectSession') {
        this._selectSession(data.target);
      } else if (data.command === 'syncTurns' || data.command === 'ready') {
        this._syncCurrentSessionTurns(true);
      } else if (data.command === 'openEditorTab') {
        this._openCurrentInEditorTab(data.target);
      } else if (data.command === 'openLink') {
        if (data.url && data.url.startsWith('file://')) {
          const filePath = data.url.replace(/^file:\/\//, '');
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        } else if (data.url) {
          vscode.env.openExternal(vscode.Uri.parse(data.url));
        }
      }
    });

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
      if (this._currentTarget === '__active__') {
        this._currentSessionName = res.sessionName;
        this._currentCid = res.cid || (res.sessionName && res.sessionName.startsWith('rc_') ? res.sessionName.slice(3) : null);
        this._tPath = resolveTranscriptPath(this._currentCid, this._currentSessionName);
        this._syncCurrentSessionTurns(true);
      }
    } else {
      this._view.webview.postMessage({
        type: 'syncActiveSession',
        label: terminal ? terminal.name : '선택 필요',
        sessionName: null
      });
    }
  }

  _selectSession(targetVal) {
    this._currentTarget = targetVal || '__active__';
    let sessionName = null;
    let cid = null;

    if (this._currentTarget === '__active__') {
      const res = resolveTmuxSessionFromTerminal(vscode.window.activeTerminal, this.treeDataProvider.cachedData);
      if (res) {
        sessionName = res.sessionName;
        cid = res.cid || (sessionName.startsWith('rc_') ? sessionName.slice(3) : null);
      } else {
        const rc = this.treeDataProvider.cachedData?.remoteControl;
        if (rc && rc.length > 0) {
          cid = rc[0].cid;
          sessionName = getTmuxSessionName(cid);
        }
      }
    } else if (this._currentTarget.startsWith('rc:')) {
      cid = this._currentTarget.slice(3);
      sessionName = getTmuxSessionName(cid);
    } else if (this._currentTarget.startsWith('tmux:')) {
      sessionName = this._currentTarget.slice(5);
      const match = (this.treeDataProvider.cachedData?.agy || []).find(s => s.name === sessionName);
      if (match && match.cid) cid = match.cid;
    }

    this._currentSessionName = sessionName;
    this._currentCid = cid;
    this._tPath = resolveTranscriptPath(cid, sessionName);
    this._lastMtime = 0;
    this._syncCurrentSessionTurns(true);
  }

  _syncCurrentSessionTurns(isInit = false) {
    if (!this._view) return;
    if (!this._tPath && (this._currentCid || this._currentSessionName)) {
      this._tPath = resolveTranscriptPath(this._currentCid, this._currentSessionName);
    }

    if (!this._tPath || !fs.existsSync(this._tPath)) {
      if (isInit) {
        this._view.webview.postMessage({
          type: 'initTurns',
          turns: [],
          totalCount: 0
        });
      }
      return;
    }

    try {
      const stat = fs.statSync(this._tPath);
      if (!isInit && stat.mtimeMs === this._lastMtime) return;
      this._lastMtime = stat.mtimeMs;

      const parsed = parseTranscriptFile(this._tPath, 25);
      this._view.webview.postMessage({
        type: isInit ? 'initTurns' : 'updateTurns',
        turns: parsed.turns,
        totalCount: parsed.totalCount
      });
    } catch (e) {}
  }

  _openCurrentInEditorTab(targetVal) {
    const target = targetVal || this._currentTarget;
    let sessionObj = null;

    if (target && target.startsWith('rc:')) {
      const cid = target.slice(3);
      const match = (this.treeDataProvider.cachedData?.remoteControl || []).find(s => s.cid === cid);
      sessionObj = match || { cid, title: cid };
    } else if (target && target.startsWith('tmux:')) {
      const sName = target.slice(5);
      sessionObj = { name: sName };
    } else {
      if (this._currentCid) {
        const match = (this.treeDataProvider.cachedData?.remoteControl || []).find(s => s.cid === this._currentCid);
        sessionObj = match || { cid: this._currentCid };
      } else if (this._currentSessionName) {
        sessionObj = { name: this._currentSessionName };
      }
    }

    if (sessionObj) {
      vscode.commands.executeCommand('sessionManager.openSessionPanel', sessionObj);
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
    let targetCid = null;

    if (!targetVal || targetVal === '__active__') {
      if (this._currentSessionName) {
        targetSession = this._currentSessionName;
        targetCid = this._currentCid || null;
        targetLabel = this._currentCid ? `[${this._currentCid.slice(0, 4)}]` : targetSession;
      } else {
        const res = resolveTmuxSessionFromTerminal(vscode.window.activeTerminal, this.treeDataProvider.cachedData);
        if (res) {
          targetSession = res.sessionName;
          targetLabel = res.label;
          targetCid = res.cid || null;
        } else {
          const rc = this.treeDataProvider.cachedData?.remoteControl;
          const agy = this.treeDataProvider.cachedData?.agy;
          if (rc && rc.length > 0) {
            targetCid = rc[0].cid;
            targetSession = getTmuxSessionName(rc[0].cid);
            targetLabel = `[${rc[0].cid.slice(0, 4)}] ${rc[0].title || rc[0].cid}`;
            attachRemoteControl(rc[0].cid, rc[0].title);
          } else if (agy && agy.length > 0) {
            targetSession = agy[0].name;
            targetLabel = agy[0].name;
            targetCid = agy[0].cid || null;
            attachToSession(targetSession);
          }
        }
      }
    } else if (targetVal.startsWith('rc:')) {
      targetCid = targetVal.slice(3);
      targetSession = getTmuxSessionName(targetCid);
      const match = (this.treeDataProvider.cachedData?.remoteControl || []).find(s => s.cid === targetCid);
      targetLabel = match ? `[${targetCid.slice(0, 4)}] ${match.title}` : targetSession;
      attachRemoteControl(targetCid, match ? match.title : null);
    } else if (targetVal.startsWith('tmux:')) {
      targetSession = targetVal.slice(5);
      targetLabel = targetSession;
      attachToSession(targetSession);
    }

    if (!targetSession) {
      vscode.window.showWarningMessage('활성화된 세션을 찾을 수 없습니다. 세션을 먼저 선택하거나 열어주세요.');
      return;
    }

    const success = await sendTextToTmux(targetSession, text, targetCid);
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
  <link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'))}">
</head>
<body class="is-sidebar">
  <div class="panel-container">
    <header class="chat-header sidebar-target-header">
      <div class="target-bar">
        <span class="target-label">🎯 대상:</span>
        <select id="session-select" class="session-select"></select>
        <button id="btn-sync" class="icon-btn" title="대화 동기화">🔄</button>
        <button id="btn-open-tab" class="icon-btn" title="에디터 탭으로 열기">↗</button>
      </div>
    </header>

    <div id="messages-container" class="messages-container">
      <div id="empty-state" class="empty-state">대화 기록을 불러오는 중...</div>
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

  <script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'))}"></script>
  <script nonce="${nonce}">
    const sessionSelect = document.getElementById('session-select');
    const btnOpenTab = document.getElementById('btn-open-tab');

    if (sessionSelect) {
      sessionSelect.addEventListener('change', () => {
        vscode.postMessage({ command: 'selectSession', target: sessionSelect.value });
      });
    }

    if (btnOpenTab) {
      btnOpenTab.addEventListener('click', () => {
        vscode.postMessage({ command: 'openEditorTab', target: sessionSelect ? sessionSelect.value : null });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateSessions') {
        const currentVal = sessionSelect.value;
        sessionSelect.innerHTML = '';

        const optAuto = document.createElement('option');
        optAuto.value = '__active__';
        optAuto.textContent = '⚡ [자동] 활성 세션';
        sessionSelect.appendChild(optAuto);

        if (Array.isArray(msg.remoteControl) && msg.remoteControl.length > 0) {
          const grp = document.createElement('optgroup');
          grp.label = '── Remote Control ──';
          for (const s of msg.remoteControl) {
            const opt = document.createElement('option');
            opt.value = 'rc:' + s.cid;
            const shortCid = s.cid ? s.cid.slice(0, 4) : '';
            opt.textContent = '[' + shortCid + '] ' + (s.title || s.cid);
            grp.appendChild(opt);
          }
          sessionSelect.appendChild(grp);
        }

        if (Array.isArray(msg.agy) && msg.agy.length > 0) {
          const grp = document.createElement('optgroup');
          grp.label = '── AGY Tmux ──';
          for (const s of msg.agy) {
            const opt = document.createElement('option');
            opt.value = 'tmux:' + s.name;
            opt.textContent = s.displayName ? (s.displayName + ' (' + s.name + ')') : (s.title ? (s.name + ' (' + s.title + ')') : s.name);
            grp.appendChild(opt);
          }
          sessionSelect.appendChild(grp);
        }

        if (currentVal) {
          sessionSelect.value = currentVal;
        }
      } else if (msg.type === 'syncActiveSession') {
        if (sessionSelect && sessionSelect.value === '__active__') {
          const autoOpt = sessionSelect.querySelector('option[value="__active__"]');
          if (autoOpt) {
            autoOpt.textContent = '⚡ [자동] 현재: ' + (msg.label || '선택 필요');
          }
        }
      }
    });

    vscode.postMessage({ command: 'requestSessions' });
  </script>
</body>
</html>`;
  }
}

async function handleQuickPrompt(arg, treeDataProvider) {
  let targetSession = null;
  let targetTitle = null;
  let targetCid = null;

  if (arg && arg.session) {
    if (arg.contextValue === 'remoteControlItem') {
      targetCid = arg.session.cid;
      targetSession = getTmuxSessionName(arg.session.cid);
      targetTitle = `[${arg.session.cid.slice(0, 4)}] ${arg.session.title}`;
      attachRemoteControl(arg.session.cid, arg.session.title);
    } else {
      targetSession = arg.session.name;
      targetTitle = targetSession;
      targetCid = arg.session.cid || null;
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
      targetCid = res.cid || null;
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
          label: `$(sparkle) ${s.displayName || s.name}`,
          description: s.displayName ? `${s.name} • ${s.cmd}` : (s.title || s.cmd),
          sessionName: s.name,
          cid: s.cid,
          title: s.title
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
      targetCid = picked.cid || null;
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
    const ok = await sendTextToTmux(targetSession, input.trim(), targetCid);
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
  const panelManager = new SessionChatPanelManager(context.extensionUri, context.subscriptions, sendTextToTmux, attachToSession, attachRemoteControl);
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

  // New conversations are created inside the remote-control daemon, so they
  // show up on antigravity.google.com and in this manager at once.
  const newAgyCmd = vscode.commands.registerCommand('sessionManager.newAgy', async () => {
    const title = await vscode.window.showInputBox({
      prompt: 'Title for the new Antigravity conversation (optional)',
      placeHolder: 'e.g. music tagger'
    });
    if (title === undefined) return;
    const text = await vscode.window.showInputBox({
      prompt: 'First message to the agent',
      placeHolder: 'What should the agent work on?'
    });
    if (!text) return;

    try {
      const res = await fetch('http://127.0.0.1:8789/api/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title: title.trim() || undefined })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        vscode.window.showErrorMessage(`Could not create conversation: ${body.error || res.status}`);
        return;
      }
      vscode.window.showInformationMessage('Conversation created in the Antigravity daemon.');
      setTimeout(() => treeDataProvider.refresh(), 1500);
    } catch (e) {
      vscode.window.showErrorMessage(`Session manager (:8789) unreachable: ${e.message}`);
    }
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

  const handleTranscriptChange = (uri) => {
    const parts = uri.fsPath.split(path.sep);
    const brainIdx = parts.indexOf('brain');
    if (brainIdx !== -1 && parts[brainIdx + 1]) {
      panelManager.syncTranscript(parts[brainIdx + 1]);
    }
  };

  const ideTranscriptWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-ide/brain'), '*/.system_generated/logs/transcript.jsonl')
  );
  ideTranscriptWatcher.onDidChange(handleTranscriptChange);
  ideTranscriptWatcher.onDidCreate(handleTranscriptChange);

  const cliTranscriptWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-cli/brain'), '*/.system_generated/logs/transcript.jsonl')
  );
  cliTranscriptWatcher.onDidChange(handleTranscriptChange);
  cliTranscriptWatcher.onDidCreate(handleTranscriptChange);

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-cli'), 'conversation_summaries.db*')
  );
  watcher.onDidChange(() => treeDataProvider.smartRefresh(false));
  watcher.onDidCreate(() => treeDataProvider.smartRefresh(false));

  context.subscriptions.push(
    openPanelCmd, attachCmd, attachRcCmd, reloadRcCmd, deleteRcCmd, refreshCmd, newAgyCmd, killCmd,
    sendPromptCmd, focusComposerCmd,
    composerViewReg, terminalChangeSub,
    watcher, ideTranscriptWatcher, cliTranscriptWatcher,
    { dispose: () => clearInterval(interval) }
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
