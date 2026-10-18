const vscode = require('vscode');
const { exec } = require('child_process');
const { getCategorizedSessions } = require('./session-discovery');

class CategoryItem extends vscode.TreeItem {
  constructor(label, key, count, defaultExpanded = false) {
    super(
      label,
      defaultExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.key = key;
    this.description = `(${count})`;
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
    super(session.title || 'Unnamed Session', vscode.TreeItemCollapsibleState.None);
    this.session = session;
    this.description = `${session.time_str} • ${session.steps} steps`;

    const lines = [
      `Title: ${session.title}`,
      `Conversation ID: ${session.cid}`,
      `Last Modified: ${session.time_str}`,
      `Database Size: ${session.size_kb} KB`,
      '',
      '👉 Click to attach terminal (agy --conversation)'
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

    if (session.title) {
      this.description = `${session.title} (${session.cmd || 'idle'})`;
    } else {
      this.description = `PID ${session.pid} [${session.cmd || 'idle'}]`;
    }

    const lines = [
      `Session: ${session.name}`,
      `Command: ${session.cmd} (PID: ${session.pid})`
    ];
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
      this.iconPath = new vscode.ThemeIcon('sparkle');
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
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      try {
        this.cachedData = await getCategorizedSessions();
      } catch (e) {
        console.error('Error fetching sessions:', e);
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

function attachRemoteControl(cid, title) {
  if (!cid) return;
  const terminalName = `AGY: ${title || cid.slice(0, 8)}`;
  const existing = vscode.window.terminals.find(t => t.name === terminalName);
  if (existing) {
    existing.show();
    return;
  }

  const safeSlug = (title || 'conv').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 15);
  const tmuxSessionName = `rc_${safeSlug}_${cid.slice(0, 4)}`;

  const terminal = vscode.window.createTerminal({
    name: terminalName,
    shellPath: 'tmux',
    shellArgs: ['new-session', '-A', '-s', tmuxSessionName, `agy --conversation=${cid}`]
  });
  terminal.show();
}

function activate(context) {
  console.log('Session Manager extension is now active!');

  const treeDataProvider = new SessionTreeDataProvider();
  vscode.window.registerTreeDataProvider('sessionManagerView', treeDataProvider);

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

  const interval = setInterval(() => {
    treeDataProvider.refresh();
  }, 30000);

  context.subscriptions.push(attachCmd, attachRcCmd, refreshCmd, newAgyCmd, killCmd, {
    dispose: () => clearInterval(interval)
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
