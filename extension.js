const vscode = require('vscode');
const { getCategorizedSessions } = require('./session-discovery');
const { exec, execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DELETE_SESSION_PY = path.join(__dirname, 'delete-session.py');

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
      '👉 Click to attach terminal (agy --conversation)',
      '🔄 Click reload icon to sync latest turns from phone/hub',
      '🗑️ Click trash icon to delete session'
    ];
    this.tooltip = lines.join('\n');
    this.contextValue = 'remoteControlItem';
    this.iconPath = new vscode.ThemeIcon('radio-tower');

    this.command = {
      command: 'sessionManager.attachRemoteControl',
      title: 'Attach to Remote Control Session',
      arguments: [session.cid, session.title]
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
    lines.push('👉 Click to attach terminal');
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
      command: 'sessionManager.attach',
      title: 'Attach to Session',
      arguments: [session.name]
    };
  }
}

class SessionTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.cachedData = { remoteControl: [], agy: [], claude: [], codex: [], other: [] };
    this.lastDataHash = '';
  }

  // Smart refresh: only fire UI update when data actually changed
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
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['attach-session', '-t', sessionName]
  });
  terminal.show();
}

function getTmuxSessionName(cid) {
  return `rc_${(cid || '').slice(0, 8)}`;
}

function attachRemoteControl(cid, title, treeDataProvider) {
  if (!cid) return;
  const terminalName = `AGY: ${title || cid.slice(0, 8)}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    vscode.window.showInformationMessage(
      `Showing "${terminalName}". Chatted on phone? Click "Reload" to sync latest turns.`,
      'Reload'
    ).then(sel => {
      if (sel === 'Reload') {
        reloadRemoteControl(cid, title);
      }
    });
    return;
  }

  const tmuxSessionName = getTmuxSessionName(cid);

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['new-session', '-A', '-s', tmuxSessionName, `agy --conversation=${cid}`]
  });
  terminal.show();
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

  // 1. Close open VS Code terminal
  const terminalName = `AGY: ${displayTitle}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.dispose();
  }

  // 2. Kill tmux session if running
  const tmuxSessionName = getTmuxSessionName(cid);
  try {
    execSync(`tmux kill-session -t "${tmuxSessionName}" 2>/dev/null || true`);
  } catch (e) {}

  // 3. Delete files & DB record via delete-session.py
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

function activate(context) {
  // Ensure tmux mouse scrolling and large history limit are enabled globally
  try {
    exec('tmux set -g mouse on 2>/dev/null || true');
    exec('tmux set -g history-limit 50000 2>/dev/null || true');
  } catch (e) {}

  console.log('Session Manager extension is now active!');

  const treeDataProvider = new SessionTreeDataProvider();
  vscode.window.registerTreeDataProvider('sessionManagerView', treeDataProvider);

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
    attachRemoteControl(cid, title, treeDataProvider);
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

  // Smart auto-refresh every 4 seconds (zero flicker if no data changes)
  const interval = setInterval(() => {
    treeDataProvider.smartRefresh(false);
  }, 4000);

  // File system watcher for instant refresh when phone writes to conversation_summaries.db
  const homeDir = process.env.HOME || '/home/ttolmany';
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.join(homeDir, '.gemini/antigravity-cli'), 'conversation_summaries.db*')
  );
  watcher.onDidChange(() => treeDataProvider.smartRefresh(false));
  watcher.onDidCreate(() => treeDataProvider.smartRefresh(false));

  context.subscriptions.push(
    attachCmd, attachRcCmd, reloadRcCmd, deleteRcCmd, refreshCmd, newAgyCmd, killCmd,
    watcher,
    { dispose: () => clearInterval(interval) }
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
