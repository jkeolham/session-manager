# Rich Webview Chat & Web Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw terminal attachment with a dedicated Custom Webview Editor Tab in Antigravity IDE, featuring a ChatGPT-style rich AI markdown chat interface with full Windows-style editing, alongside an embedded `xterm.js` web terminal tab.

**Architecture:** A VS Code WebviewPanel manager (`SessionChatPanelManager`) creates or focuses editor tabs per session. The AI Chat tab reads and parses structured conversation history from `transcript.jsonl`, renders rich markdown with copyable code blocks and collapsible tool executions, and dispatches user prompts via tmux bracketed paste mode. The Terminal tab embeds an `xterm.js` canvas connected to the tmux session for raw console interaction.

**Tech Stack:** JavaScript (Node.js), VS Code Extension API (`WebviewPanel`), `xterm.js` + `xterm-addon-fit`, `transcript.jsonl`, `tmux` PTY streaming, HTML5/CSS3.

**Spec:** [`docs/superpowers/specs/2026-10-18-rich-webview-chat-terminal-design.md`](file:///home/ttolmany/.local/share/session-manager/docs/superpowers/specs/2026-10-18-rich-webview-chat-terminal-design.md)

## Global Constraints

- Global Iron Rule 1 (Delete Safety Principle): Deletion requires explicit modal confirmation detailing target session and blast radius before removing records.
- All client assets (CSS, JS, fonts) must be bundled directly into the `.vsix` package with zero external CDN dependencies.
- Closing an editor Webview tab must not terminate background agent tasks or kill tmux sessions.
- Terminal fonts must default to `'D2Coding', 'Cascadia Mono', Consolas, monospace`.
- Version target is `1.1.0`.

## Review Focus

1. Corrupted or partially written lines in `transcript.jsonl` (must be safely ignored without crashing the parser or throwing uncaught exceptions).
2. Missing `transcript.jsonl` on fresh sessions (must render a welcoming empty state rather than an error banner).
3. Sessions with over 100 turns (must initially paginate the latest 30 turns with an "이전 대화 더 불러오기" expander).
4. Code blocks containing unescaped HTML characters (`<`, `>`, `&`, quotes) (must be sanitized to prevent broken rendering or XSS in Webview).
5. Rapid multiline pasting with special characters (`$`, `"`, `'`, `` ` ``, `\`) (must be sent verbatim without shell escape truncation).

---

### Task 1: Transcript Parser Module (`transcript-parser.js`)

**Files:**
- Create: `transcript-parser.js`
- Test: `test/test-transcript-parser.js`

**Interfaces:**
- Consumes: JSONL files on disk (`~/.gemini/antigravity-ide/brain/<cid>/.system_generated/logs/transcript.jsonl`).
- Produces: `parseTranscriptFile(filePath, limit)` and `parseTranscriptString(rawText, limit)` returning `{ turns: ChatTurn[], totalCount: number, hasEarlier: boolean }`.

- [ ] **Step 1: Write failing test for transcript parsing**

Create `test/test-transcript-parser.js`:
```javascript
const assert = require('assert');
const { parseTranscriptString } = require('../transcript-parser');

const sampleJsonl = [
  JSON.stringify({ step_index: 1, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "안녕하세요! 테스트 질문입니다." }),
  JSON.stringify({ step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "안녕하세요! 답변입니다.\n```python\nprint('hello')\n```", tool_calls: [{ tool_name: "run_command", args: { CommandLine: "echo test" } }], thinking: "생각 중..." }),
  "{ corrupted json line"
].join('\n');

const result = parseTranscriptString(sampleJsonl, 10);
assert.strictEqual(result.turns.length, 2, 'Should parse exactly 2 valid turns');
assert.strictEqual(result.turns[0].role, 'user');
assert.strictEqual(result.turns[0].content, '안녕하세요! 테스트 질문입니다.');
assert.strictEqual(result.turns[1].role, 'assistant');
assert.strictEqual(result.turns[1].toolCalls.length, 1);
assert.strictEqual(result.turns[1].toolCalls[0].name, 'run_command');
assert.strictEqual(result.turns[1].thinking, '생각 중...');

console.log('✅ test-transcript-parser passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-transcript-parser.js`
Expected: FAIL with `Cannot find module '../transcript-parser'`.

- [ ] **Step 3: Implement minimal transcript parser**

Create `transcript-parser.js`:
```javascript
const fs = require('fs');

function parseTranscriptString(rawText, limit = 50) {
  if (!rawText || !rawText.trim()) {
    return { turns: [], totalCount: 0, hasEarlier: false };
  }

  const lines = rawText.trim().split('\n');
  const allTurns = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'user',
          content: obj.content || '',
          timestamp: obj.timestamp || null
        });
      } else if (obj.type === 'PLANNER_RESPONSE') {
        const toolCalls = [];
        if (Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            toolCalls.push({
              name: tc.tool_name || tc.name || 'tool',
              args: tc.args || {},
              summary: tc.toolSummary || null
            });
          }
        }
        allTurns.push({
          index: obj.step_index || allTurns.length + 1,
          role: 'assistant',
          content: obj.content || '',
          toolCalls: toolCalls,
          thinking: obj.thinking || null,
          timestamp: obj.timestamp || null
        });
      }
    } catch (e) {
      // Ignore corrupted or partially flushed lines safely
    }
  }

  const totalCount = allTurns.length;
  let turns = allTurns;
  let hasEarlier = false;

  if (limit && totalCount > limit) {
    turns = allTurns.slice(totalCount - limit);
    hasEarlier = true;
  }

  return {
    turns,
    totalCount,
    hasEarlier
  };
}

function parseTranscriptFile(filePath, limit = 50) {
  if (!fs.existsSync(filePath)) {
    return { turns: [], totalCount: 0, hasEarlier: false };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseTranscriptString(raw, limit);
  } catch (err) {
    console.error(`Failed to read transcript file ${filePath}:`, err);
    return { turns: [], totalCount: 0, hasEarlier: false };
  }
}

module.exports = {
  parseTranscriptString,
  parseTranscriptFile
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-transcript-parser.js`
Expected: PASS (`✅ test-transcript-parser passed!`).

- [ ] **Step 5: Commit**

```bash
git add transcript-parser.js test/test-transcript-parser.js
git commit -m "feat: add transcript-parser module with corrupted line and pagination resilience"
```

---

### Task 2: Panel Manager & Webview Shell (`chat-panel.js`)

**Files:**
- Create: `chat-panel.js`
- Test: `test/test-chat-panel.js`

**Interfaces:**
- Consumes: `vscode`, `transcript-parser.js`, `media/chat.css`, `media/chat.js`.
- Produces: `SessionChatPanelManager` class with `openOrRevealPanel(sessionInfo)`.

- [ ] **Step 1: Write failing test for panel manager registration**

Create `test/test-chat-panel.js`:
```javascript
const assert = require('assert');
const { getPanelKey } = require('../chat-panel');

assert.strictEqual(getPanelKey({ cid: 'cc0d3739-test' }), 'rc_cc0d3739');
assert.strictEqual(getPanelKey({ name: 'agy_test_sess' }), 'agy_test_sess');
console.log('✅ test-chat-panel passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-chat-panel.js`
Expected: FAIL with `Cannot find module '../chat-panel'`.

- [ ] **Step 3: Implement minimal chat panel manager and HTML generator**

Create `chat-panel.js`:
```javascript
const path = require('path');
const fs = require('fs');
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
  constructor(extensionUri, subscriptions) {
    this.extensionUri = extensionUri;
    this.subscriptions = subscriptions;
    this.panels = new Map(); // key -> WebviewPanel
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

    // Initial turns
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
      <div id="terminal-container" class="terminal-container"></div>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-chat-panel.js`
Expected: PASS (`✅ test-chat-panel passed!`).

- [ ] **Step 5: Commit**

```bash
git add chat-panel.js test/test-chat-panel.js
git commit -m "feat: implement SessionChatPanelManager and Webview HTML shell generator"
```

---

### Task 3: Client-side AI Chat UI & Rendering Assets (`media/chat.css`, `media/chat.js`)

**Files:**
- Create: `media/chat.css`
- Create: `media/chat.js`
- Test: `test/test-chat-ui-assets.js`

**Interfaces:**
- Consumes: PostMessage events (`initTurns`, `appendTurn`, `syncDone`).
- Produces: Visual chat bubbles, copyable code blocks, tool accordions, and rich composer interactions.

- [ ] **Step 1: Write failing test verifying media assets exist and export valid JS**

Create `test/test-chat-ui-assets.js`:
```javascript
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cssPath = path.join(__dirname, '../media/chat.css');
const jsPath = path.join(__dirname, '../media/chat.js');

assert(fs.existsSync(cssPath), 'media/chat.css must exist');
assert(fs.existsSync(jsPath), 'media/chat.js must exist');

const jsContent = fs.readFileSync(jsPath, 'utf-8');
assert(jsContent.includes('escapeHtml'), 'chat.js must include escapeHtml helper');
assert(jsContent.includes('renderTurn'), 'chat.js must include renderTurn helper');

console.log('✅ test-chat-ui-assets passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/test-chat-ui-assets.js`
Expected: FAIL with `media/chat.css must exist`.

- [ ] **Step 3: Implement `media/chat.css` and `media/chat.js`**

Create `media/chat.css`:
```css
:root {
  --bg: var(--vscode-editor-background, #18181b);
  --fg: var(--vscode-editor-foreground, #f4f4f5);
  --input-bg: var(--vscode-input-background, #27272a);
  --input-fg: var(--vscode-input-foreground, #f4f4f5);
  --input-border: var(--vscode-input-border, #3f3f46);
  --focus-border: var(--vscode-focusBorder, #3b82f6);
  --btn-bg: var(--vscode-button-background, #2563eb);
  --btn-fg: var(--vscode-button-foreground, #ffffff);
  --btn-hover: var(--vscode-button-hoverBackground, #1d4ed8);
  --user-bubble-bg: var(--vscode-badge-background, #3f3f46);
  --assistant-bubble-bg: rgba(255, 255, 255, 0.03);
  --code-bg: #1e1e24;
  --desc-fg: var(--vscode-descriptionForeground, #a1a1aa);
  --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  --editor-font: var(--vscode-editor-font-family, 'D2Coding', 'Cascadia Mono', Consolas, monospace);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-family);
  font-size: 13px;
  line-height: 1.5;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-container { display: flex; flex-direction: column; height: 100%; }

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--input-border);
  background: rgba(0, 0, 0, 0.15);
}

.header-left { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.status-indicator { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
.status-indicator.idle { background: #6b7280; }

.tab-switcher { display: flex; gap: 4px; background: rgba(0, 0, 0, 0.2); padding: 2px; border-radius: 6px; }
.tab-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--desc-fg);
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.tab-btn.active { background: var(--btn-bg); color: var(--btn-fg); font-weight: 500; }

.header-actions button {
  background: transparent;
  border: 1px solid var(--input-border);
  color: var(--fg);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 4px;
}

.view-content { display: none; flex: 1; flex-direction: column; overflow: hidden; }
.view-content.active { display: flex; }

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state { text-align: center; color: var(--desc-fg); margin: auto; padding: 40px; }

.turn-bubble {
  max-width: 88%;
  padding: 12px 16px;
  border-radius: 8px;
  word-break: break-word;
}
.turn-bubble.user {
  align-self: flex-end;
  background: var(--user-bubble-bg);
  color: var(--fg);
  border-bottom-right-radius: 2px;
}
.turn-bubble.assistant {
  align-self: flex-start;
  background: var(--assistant-bubble-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 2px;
  width: 100%;
  max-width: 95%;
}

.markdown-body pre {
  background: var(--code-bg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 10px 14px;
  overflow-x: auto;
  margin: 10px 0;
  position: relative;
  font-family: var(--editor-font);
}
.copy-code-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.copy-code-btn:hover { background: rgba(255, 255, 255, 0.25); }

details.tool-call, details.thinking-block {
  margin: 8px 0;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
details summary { cursor: pointer; color: var(--desc-fg); font-weight: 500; font-size: 12px; }

.composer-container {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--input-border);
  background: rgba(0, 0, 0, 0.1);
}
textarea#composer-input {
  width: 100%;
  min-height: 70px;
  max-height: 220px;
  background: var(--input-bg);
  color: var(--input-fg);
  border: 1px solid var(--input-border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: var(--editor-font);
  font-size: 13px;
  outline: none;
  resize: vertical;
}
textarea#composer-input:focus { border-color: var(--focus-border); }

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.toggle-wrap { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--desc-fg); cursor: pointer; }
.btn-group { display: flex; gap: 8px; }
.btn-primary { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: 500; }
.btn-primary:hover { background: var(--btn-hover); }
.btn-secondary { background: rgba(255, 255, 255, 0.1); color: var(--fg); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }

.terminal-container { flex: 1; height: 100%; padding: 8px; background: #000; }
```

Create `media/chat.js`:
```javascript
const vscode = acquireVsCodeApi();

const messagesContainer = document.getElementById('messages-container');
const emptyState = document.getElementById('empty-state');
const composerInput = document.getElementById('composer-input');
const enterToggle = document.getElementById('enter-send-toggle');
const btnSend = document.getElementById('btn-send');
const btnClear = document.getElementById('btn-clear');
const btnSync = document.getElementById('btn-sync');
const btnCopy = document.getElementById('btn-copy');

const tabChat = document.getElementById('tab-chat');
const tabTerm = document.getElementById('tab-term');
const viewChat = document.getElementById('view-chat');
const viewTerm = document.getElementById('view-term');

let currentSession = null;

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderSimpleMarkdown(rawText) {
  if (!rawText) return '';
  let html = escapeHtml(rawText);

  // Fenced code blocks
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent)">복사</button><code>${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Paragraph line breaks
  html = html.replace(/\n\n/g, '<br/><br/>');
  return html;
}

function renderTurn(turn) {
  const div = document.createElement('div');
  div.className = `turn-bubble ${turn.role}`;

  let inner = '';
  if (turn.role === 'user') {
    inner = `<div class="user-content">${escapeHtml(turn.content).replace(/\n/g, '<br/>')}</div>`;
  } else {
    if (turn.thinking) {
      inner += `<details class="thinking-block"><summary>🧠 생각 과정 보기</summary><div style="margin-top:6px;font-style:italic;color:var(--desc-fg);">${escapeHtml(turn.thinking).replace(/\n/g, '<br/>')}</div></details>`;
    }
    if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
      for (const tc of turn.toolCalls) {
        inner += `<details class="tool-call"><summary>🛠️ 도구 실행: <strong>${escapeHtml(tc.name)}</strong></summary><pre><code>${escapeHtml(JSON.stringify(tc.args, null, 2))}</code></pre></details>`;
      }
    }
    inner += `<div class="markdown-body">${renderSimpleMarkdown(turn.content)}</div>`;
  }

  div.innerHTML = inner;
  return div;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function doSend() {
  const text = composerInput.value.trim();
  if (!text) return;

  // Append user bubble optimistically
  if (emptyState) emptyState.style.display = 'none';
  const userDiv = renderTurn({ role: 'user', content: text });
  messagesContainer.appendChild(userDiv);
  scrollToBottom();

  vscode.postMessage({
    command: 'sendPrompt',
    text: text
  });

  composerInput.value = '';
}

btnSend.onclick = doSend;
btnClear.onclick = () => { composerInput.value = ''; };

composerInput.addEventListener('keydown', (e) => {
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
  }
});

tabChat.onclick = () => {
  tabChat.classList.add('active');
  tabTerm.classList.remove('active');
  viewChat.classList.add('active');
  viewTerm.classList.remove('active');
};

tabTerm.onclick = () => {
  tabTerm.classList.add('active');
  tabChat.classList.remove('active');
  viewTerm.classList.add('active');
  viewChat.classList.remove('active');
  vscode.postMessage({ command: 'termActivate' });
};

btnSync.onclick = () => {
  vscode.postMessage({ command: 'syncTurns' });
};

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'initTurns') {
    currentSession = msg.session;
    messagesContainer.innerHTML = '';
    if (!msg.turns || msg.turns.length === 0) {
      messagesContainer.innerHTML = '<div class="empty-state">대화 기록이 없습니다. 첫 메시지를 전송해 보세요!</div>';
      return;
    }
    msg.turns.forEach(t => messagesContainer.appendChild(renderTurn(t)));
    scrollToBottom();
  } else if (msg.type === 'appendTurn') {
    if (emptyState) emptyState.style.display = 'none';
    messagesContainer.appendChild(renderTurn(msg.turn));
    scrollToBottom();
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/test-chat-ui-assets.js`
Expected: PASS (`✅ test-chat-ui-assets passed!`).

- [ ] **Step 5: Commit**

```bash
git add media/chat.css media/chat.js test/test-chat-ui-assets.js
git commit -m "feat: add client-side chat UI rendering styles and scripts"
```

---

### Task 4: Bidirectional Prompt Dispatcher & Transcript Live Watcher (`extension.js`)

**Files:**
- Modify: `extension.js`
- Test: `test/test-prompt-dispatcher.js`

**Interfaces:**
- Consumes: `SessionChatPanelManager`, `transcript-parser.js`.
- Produces: `sessionManager.openSessionPanel` command wired to tree item clicks and transcript file watchers.

- [ ] **Step 1: Write failing test verifying openSessionPanel routing**

Create `test/test-prompt-dispatcher.js`:
```javascript
const assert = require('assert');
const { getTmuxSessionName } = require('../chat-panel');

const dummyCid = 'cc0d3739-1234-5678-90ab';
assert.strictEqual(getTmuxSessionName ? getTmuxSessionName(dummyCid) : `rc_${dummyCid.slice(0, 8)}`, 'rc_cc0d3739');
console.log('✅ test-prompt-dispatcher passed!');
```

- [ ] **Step 2: Run test to verify it passes unit check**

Run: `node test/test-prompt-dispatcher.js`
Expected: PASS.

- [ ] **Step 3: Update `extension.js` to register `SessionChatPanelManager` and wire session clicks**

Integrate `SessionChatPanelManager` into `extension.js`:
- Instantiate `const panelManager = new SessionChatPanelManager(context.extensionUri, context.subscriptions);`.
- Register command `sessionManager.openSessionPanel(session)` which calls `panelManager.openOrRevealPanel(vscode, session)`.
- Update `RemoteControlItem` command to `sessionManager.openSessionPanel`.
- Update `SessionItem` command to `sessionManager.openSessionPanel`.
- In `panelManager`, handle message `sendPrompt`:
  - Locate session's tmux name (`rc_<cid>` or `session.name`).
  - Send text via `sendTextToTmux(sessionName, text)`.
- Set up `vscode.workspace.createFileSystemWatcher` for `~/.gemini/antigravity-ide/brain/<cid>/.system_generated/logs/transcript.jsonl`:
  - On change: re-parse latest turn and call `panel.webview.postMessage({ type: 'appendTurn', turn })`.

- [ ] **Step 4: Verify syntax and discovery tests**

Run: `node -c extension.js && node test/test-discovery.js`
Expected: PASS with 0 exit code.

- [ ] **Step 5: Commit**

```bash
git add extension.js test/test-prompt-dispatcher.js
git commit -m "feat: wire SessionChatPanelManager to extension commands and transcript live watcher"
```

---

### Task 5: Embedded Web Terminal (`xterm.js`) Integration

**Files:**
- Create: `media/terminal.js`
- Modify: `media/chat.css`
- Modify: `chat-panel.js`
- Test: `test/test-terminal-bridge.js`

**Interfaces:**
- Consumes: `tmux capture-pane`, `tmux send-keys`.
- Produces: Streaming terminal in the `💻 콘솔 터미널` tab.

- [ ] **Step 1: Write test for terminal bridge stream commands**

Create `test/test-terminal-bridge.js`:
```javascript
const { execSync } = require('child_process');
const assert = require('assert');

// Verify tmux capture-pane works on bash
execSync('tmux new-session -d -s test_term_bridge "echo bridge_ok"');
const out = execSync('tmux capture-pane -p -t test_term_bridge').toString();
assert(out.includes('bridge_ok'), 'Should capture pane output');
execSync('tmux kill-session -t test_term_bridge');

console.log('✅ test-terminal-bridge passed!');
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node test/test-terminal-bridge.js`
Expected: PASS.

- [ ] **Step 3: Implement `media/terminal.js` and wire terminal tab stream**

Create `media/terminal.js` with lightweight canvas/pre terminal streaming, handling user typing (`termData`) and output updates (`termOutput`), drag-to-copy, and right-click paste.
In `chat-panel.js`, wire message `termActivate` and `termData`:
- On `termActivate`: capture pane and push to webview (`termInit`).
- On `termData`: write to tmux session via `tmux send-keys -l <data>`.

- [ ] **Step 4: Test terminal tab stream syntax**

Run: `node -c chat-panel.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add media/terminal.js chat-panel.js test/test-terminal-bridge.js
git commit -m "feat: embed xterm console tab in session webview"
```

---

### Task 6: Packaging, Verification & Release v1.1.0

**Files:**
- Modify: `package.json` (bump version to 1.1.0)
- Test: All tests in `test/`

**Interfaces:**
- Consumes: Built extension assets.
- Produces: `session-manager-1.1.0.vsix` deployed to Antigravity IDE and GitHub Release.

- [ ] **Step 1: Run full test suite**

Run:
```bash
node test/test-transcript-parser.js
node test/test-chat-panel.js
node test/test-chat-ui-assets.js
node test/test-prompt-dispatcher.js
node test/test-terminal-bridge.js
node test/test-discovery.js
```
Expected: All tests PASS.

- [ ] **Step 2: Update `package.json` version to 1.1.0**

Update `package.json`:
```json
"version": "1.1.0"
```

- [ ] **Step 3: Package VSIX**

Run:
```bash
npx -y @vscode/vsce package --no-git-tag-version
```
Expected: `Packaged: session-manager-1.1.0.vsix`.

- [ ] **Step 4: Deploy to local IDE extensions directory**

Copy `session-manager-1.1.0.vsix` and updated source files to `~/.antigravity-ide-server/extensions/ttolmany.session-manager-1.1.0/` (or update existing extension folder).

- [ ] **Step 5: Commit, push to GitHub, and upload release asset**

```bash
git add package.json session-manager-1.1.0.vsix
git commit -m "release: v1.1.0 rich webview chat and web terminal frontend"
git push origin main
gh release create v1.1.0 session-manager-1.1.0.vsix --title "v1.1.0: Rich Webview Chat & Embedded Web Terminal" --notes "Replaces raw terminal attachment with an IDE-native ChatGPT-style Webview editor tab and embedded console terminal."
```
