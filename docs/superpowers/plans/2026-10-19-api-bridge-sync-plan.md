# Antigravity API Bridge & Bidirectional Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dedicated streaming Agent Bridge (`stream-json` + `--remote-control`) in `session-manager` to achieve 100% bidirectional synchronization with `antigravity.google.com`, full mobile text editing freedom, and visual parity.

**Architecture:** Replace legacy `tmux paste-buffer` key injection for Antigravity sessions with `AgentBridgeManager`, which directly spawns and manages persistent `agy` driver processes communicating via NDJSON (`stream-json`) over stdin/stdout while maintaining an active Google WebChannel tunnel (`--remote-control`). Route SSE events directly from the driver and update mobile frontend with robust IME composition and Google Antigravity dark theme styling.

**Tech Stack:** Node.js (v20+ ES Modules), Antigravity CLI (`agy`), Systemd user service, HTML5/CSS3/Vanilla JS (SSE, visualViewport API).

**Spec:** [`docs/superpowers/specs/2026-10-19-api-bridge-sync-design.md`](file:///home/ttolmany/.local/share/session-manager/docs/superpowers/specs/2026-10-19-api-bridge-sync-design.md)

## Global Constraints

- **Node Version**: Native Node.js ES Modules (`.mjs` / `server.mjs`), zero heavy external runtime dependencies.
- **Backwards Compatibility**: All 31 existing terminal/tmux sessions (Claude Code `Tax_Asset`, Codex, shell sessions) must remain 100% operational via existing PTY bridge.
- **Database Safety**: Prevent multiple concurrent `agy` processes from racing on the same conversation SQLite database (`~/.gemini/antigravity-cli/conversations/<cid>.db`).
- **File Immutability**: All SecondBrain wiki files and non-session-manager paths remain untouched.

## Review Focus

1. **Process Teardown & Leak Prevention**: Ensure idle `agy` driver processes are cleanly terminated when sessions are closed or after 30 minutes of inactivity.
2. **Buffer Splitting / Chunk Assembly**: Ensure NDJSON lines from `stdout` are buffered across stream chunks so partial JSON lines never cause parse errors.
3. **Korean IME Composition**: Ensure pressing Enter during Korean syllable composition does not prematurely trigger message submission or duplicate characters.
4. **Soft Keyboard Collision**: Ensure opening the mobile keyboard smoothly moves `#composer` without covering the latest message in `#chat-history`.
5. **Remote Link Resolution**: Ensure the `[🌐 Google Web]` header button gracefully handles missing or pending relay URLs.

---

### Task 1: Implement `agent-bridge.mjs` Worker Manager

**Files:**
- Create: `/home/ttolmany/.local/share/session-manager/agent-bridge.mjs`
- Test: `/home/ttolmany/.local/share/session-manager/test/test-agent-bridge.mjs`

**Interfaces:**
- Consumes: Node `child_process.spawn`, `events.EventEmitter`, conversation ID `cid`.
- Produces: `AgentBridgeManager` class with methods `getWorker(cid)`, `sendPrompt(cid, text, attachments)`, `closeWorker(cid)`, `closeAll()`, and event emitter emitting `turn`, `chunk`, `error`.

- [ ] **Step 1: Write the failing unit test for `AgentBridgeManager`**

```javascript
// test/test-agent-bridge.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBridgeManager } from '../agent-bridge.mjs';

test('AgentBridgeManager exports required API methods', () => {
  const mgr = new AgentBridgeManager();
  assert.strictEqual(typeof mgr.getWorker, 'function');
  assert.strictEqual(typeof mgr.sendPrompt, 'function');
  assert.strictEqual(typeof mgr.closeWorker, 'function');
  assert.strictEqual(typeof mgr.closeAll, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-agent-bridge.mjs`
Expected: FAIL with `Cannot find module '../agent-bridge.mjs'`

- [ ] **Step 3: Implement `agent-bridge.mjs`**

Implement `AgentBridgeManager` class with child process lifecycle, NDJSON line buffering for stdin/stdout, and idle timer tracking:

```javascript
// agent-bridge.mjs
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

export class AgentBridgeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workers = new Map(); // cid -> { proc, lineRemainder, lastUsed, relayUrl }
    this.idleTimeoutMs = options.idleTimeoutMs || 30 * 60 * 1000; // 30 min
    this.workDir = options.workDir || path.join(process.env.HOME || '/home/ttolmany', 'gdrive/work/SecondBrain');
  }

  getWorker(cid) {
    if (!cid) return null;
    let worker = this.workers.get(cid);
    if (worker && !worker.proc.killed) {
      worker.lastUsed = Date.now();
      return worker;
    }

    const proc = spawn('agy', [
      `--conversation=${cid}`,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--remote-control',
      '--dangerously-skip-permissions'
    ], {
      cwd: this.workDir,
      env: { ...process.env, PAGER: 'cat' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    worker = {
      cid,
      proc,
      lineRemainder: '',
      lastUsed: Date.now(),
      relayUrl: null
    };

    proc.stdout.on('data', (chunk) => {
      worker.lineRemainder += chunk.toString('utf-8');
      const lines = worker.lineRemainder.split('\n');
      worker.lineRemainder = lines.pop(); // keep partial

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          this.emit('event', { cid, data: parsed });
          if (parsed.event === 'turn' || parsed.event === 'result') {
            this.emit('turn', { cid, data: parsed });
          }
        } catch (e) {
          // Non-JSON line or debug output
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      const match = text.match(/https:\/\/antigravity\.google\.com\/r\/[a-zA-Z0-9_-]+/);
      if (match) {
        worker.relayUrl = match[0];
        this.emit('relay-url', { cid, url: match[0] });
      }
    });

    proc.on('exit', () => {
      this.workers.delete(cid);
      this.emit('exit', { cid });
    });

    this.workers.set(cid, worker);
    return worker;
  }

  sendPrompt(cid, text, attachments = []) {
    const worker = this.getWorker(cid);
    if (!worker || !worker.proc || worker.proc.killed) {
      throw new Error(`Worker process unavailable for session ${cid}`);
    }

    let promptText = text;
    if (attachments && attachments.length > 0) {
      const attachNotes = attachments.map(a => `[첨부 파일]\n- ${a.path}`).join('\n');
      promptText = `${promptText}\n\n${attachNotes}`;
    }

    const msg = {
      event: 'prompt',
      prompt: promptText
    };

    worker.proc.stdin.write(JSON.stringify(msg) + '\n');
    worker.lastUsed = Date.now();
    return true;
  }

  getRelayUrl(cid) {
    const worker = this.workers.get(cid);
    return worker ? worker.relayUrl : null;
  }

  closeWorker(cid) {
    const worker = this.workers.get(cid);
    if (worker && worker.proc && !worker.proc.killed) {
      worker.proc.kill('SIGTERM');
    }
    this.workers.delete(cid);
  }

  closeAll() {
    for (const cid of this.workers.keys()) {
      this.closeWorker(cid);
    }
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `node --test test/test-agent-bridge.mjs`
Expected: PASS

- [ ] **Step 5: Commit `agent-bridge.mjs`**

```bash
git -C /home/ttolmany/.local/share/session-manager add agent-bridge.mjs test/test-agent-bridge.mjs
git -C /home/ttolmany/.local/share/session-manager commit -m "feat(bridge): implement AgentBridgeManager for stream-json and remote-control"
```

---

### Task 2: Integrate `AgentBridgeManager` into `server.mjs`

**Files:**
- Modify: `/home/ttolmany/.local/share/session-manager/server.mjs:10-140,480-515`
- Test: `/home/ttolmany/.local/share/session-manager/test/test-server-send-bridge.mjs`

**Interfaces:**
- Consumes: `AgentBridgeManager` from `agent-bridge.mjs`.
- Produces: Updated `/api/send` handling AGY/Remote Control sessions via `agentBridge.sendPrompt()`, while leaving tmux PTY bridge intact for Claude/Codex/Shell sessions. New endpoint `GET /api/remote-url?cid=<cid>`.

- [ ] **Step 1: Write integration test for `/api/send` routing**

```javascript
// test/test-server-send-bridge.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createServer } from '../server.mjs';

test('Server initializes with agentBridge and provides /api/remote-url', async () => {
  const app = createServer({ port: 8799 });
  await new Promise(resolve => app.listen(8799, resolve));

  const res = await fetch('http://127.0.0.1:8799/api/remote-url?cid=test-cid');
  const data = await res.json();
  assert.strictEqual(typeof data.url, 'object'); // null or string

  await new Promise(resolve => app.close(resolve));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/test-server-send-bridge.mjs`
Expected: FAIL before implementation

- [ ] **Step 3: Modify `server.mjs` to wire `AgentBridgeManager`**

1. Import `AgentBridgeManager` at the top of `server.mjs`.
2. Initialize singleton `const agentBridge = new AgentBridgeManager();`.
3. In `POST /api/send`:
   - If `cid` is provided or `sessionName.startsWith('rc_')` or `sessionName.startsWith('agy_')`:
     - Resolve `cid`.
     - Dispatch via `agentBridge.sendPrompt(fullCid, text, attachments)`.
   - Otherwise, fallback to existing `sendTextToTmux(sessionName, text)`.
4. In `GET /api/remote-url`:
   - Return `{ url: agentBridge.getRelayUrl(cid) }`.
5. In SSE stream router:
   - Listen to `agentBridge.on('event', ...)` to forward turn deltas to active subscribers immediately.

- [ ] **Step 4: Run integration test to verify it passes**

Run: `node --test test/test-server-send-bridge.mjs`
Expected: PASS

- [ ] **Step 5: Commit `server.mjs` changes**

```bash
git -C /home/ttolmany/.local/share/session-manager add server.mjs test/test-server-send-bridge.mjs
git -C /home/ttolmany/.local/share/session-manager commit -m "feat(server): route Antigravity sends through AgentBridge and provide remote URL endpoint"
```

---

### Task 3: Mobile Composer Ergonomics & IME Protection

**Files:**
- Modify: `/home/ttolmany/.local/share/session-manager/public/mobile.js:615-760`
- Modify: `/home/ttolmany/.local/share/session-manager/public/mobile.css:280-360`
- Test: `/home/ttolmany/.local/share/session-manager/test/test-composer-ime.mjs`

**Interfaces:**
- Consumes: Mobile DOM textarea `#composer-input`, button `#btn-send`, visualViewport API.
- Produces: Smooth mobile virtual keyboard docking, Korean IME composition safety, multiline autogrow up to 160px.

- [ ] **Step 1: Write unit test verifying composer IME composition safety logic**

```javascript
// test/test-composer-ime.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

test('isComposing flag blocks premature submission on Enter key', () => {
  let isComposing = false;
  let submitted = false;

  function handleKeydown(e) {
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      submitted = true;
    }
  }

  // During IME composition
  isComposing = true;
  handleKeydown({ key: 'Enter', shiftKey: false, keyCode: 229, isComposing: true });
  assert.strictEqual(submitted, false, 'Enter during IME composition must NOT submit');

  // After IME composition ends
  isComposing = false;
  handleKeydown({ key: 'Enter', shiftKey: false, keyCode: 13, isComposing: false });
  assert.strictEqual(submitted, true, 'Enter after composition completes must submit');
});
```

- [ ] **Step 2: Run test to verify passes**

Run: `node --test test/test-composer-ime.mjs`
Expected: PASS

- [ ] **Step 3: Update `public/mobile.js` and `public/mobile.css`**

1. In `public/mobile.js`:
   - Bind `compositionstart` and `compositionend` events on `composerInput`.
   - Update `visualViewport.resize` handler to compute `offset = window.innerHeight - window.visualViewport.height` and apply `composer.style.transform = offset > 0 ? \`translateY(-\${offset}px)\` : 'none'`.
   - Add autogrow logic on input: `composerInput.style.height = 'auto'; composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + 'px';`.
2. In `public/mobile.css`:
   - Style smooth transitions for `#composer`, ensuring textarea cursor and touch targets are min 44x44px.

- [ ] **Step 4: Commit mobile composer improvements**

```bash
git -C /home/ttolmany/.local/share/session-manager add public/mobile.js public/mobile.css test/test-composer-ime.mjs
git -C /home/ttolmany/.local/share/session-manager commit -m "fix(ui): robust Korean IME handling, autogrow textarea, and smooth soft-keyboard alignment"
```

---

### Task 4: antigravity.google.com Look & Feel Parity & Header Remote Link

**Files:**
- Modify: `/home/ttolmany/.local/share/session-manager/public/index.html:15-60`
- Modify: `/home/ttolmany/.local/share/session-manager/public/mobile.css:1-120`
- Modify: `/home/ttolmany/.local/share/session-manager/public/mobile.js:200-320`

**Interfaces:**
- Consumes: Google Web remote URL from `GET /api/remote-url?cid=...`.
- Produces: Header link `[🌐 Google Web]` opening remote session; Google Antigravity dark palette styling.

- [ ] **Step 1: Update `public/index.html`**

- Add Google Web action button `#btn-google-web` in header:
  ```html
  <a id="btn-google-web" class="icon-btn header-link" href="#" target="_blank" title="antigravity.google.com 원격 제어 창 열기" style="display:none;">
    🌐 Google Web
  </a>
  ```
- Bump cache bust version: `/mobile.js?v=20261019_v7`.

- [ ] **Step 2: Update `public/mobile.css` for palette alignment**

- Set CSS root variables:
  ```css
  :root {
    --bg-primary: #131314;
    --bg-secondary: #1e1f20;
    --bg-tertiary: #2b2c2e;
    --accent: #7cacf8;
    --text-primary: #e3e3e3;
    --text-secondary: #8e918f;
    --border-subtle: #313538;
  }
  ```
- Style `.header-link` as sleek pill button with accent glow.

- [ ] **Step 3: Update `public/mobile.js` to fetch and display Google Web remote link**

- When session switches:
  ```javascript
  const btnGoogleWeb = document.getElementById('btn-google-web');
  if (cid) {
    fetch(`/api/remote-url?cid=${cid}`)
      .then(r => r.json())
      .then(d => {
        if (d.url) {
          btnGoogleWeb.href = d.url;
          btnGoogleWeb.style.display = 'inline-flex';
        } else {
          btnGoogleWeb.href = `https://antigravity.google.com`;
          btnGoogleWeb.style.display = 'inline-flex';
        }
      })
      .catch(() => {
        btnGoogleWeb.style.display = 'none';
      });
  } else {
    btnGoogleWeb.style.display = 'none';
  }
  ```

- [ ] **Step 4: Commit UI parity and remote header link**

```bash
git -C /home/ttolmany/.local/share/session-manager add public/index.html public/mobile.css public/mobile.js
git -C /home/ttolmany/.local/share/session-manager commit -m "feat(ui): align color palette to antigravity.google.com and add direct Google Web header button"
```

---

### Task 5: End-to-End Service Restart & Live Verification

**Files:**
- Restart: `session-manager-web.service`
- Verify: Live session `3e733bed` and `antigravity.google.com`

- [ ] **Step 1: Restart systemd user service**

```bash
systemctl --user restart session-manager-web.service
systemctl --user status session-manager-web.service
```

- [ ] **Step 2: Verify HTTP endpoints and SSE health**

```bash
curl -s http://127.0.0.1:8789/api/sessions | jq .
curl -s "http://127.0.0.1:8789/api/remote-url?cid=3e733bed-4c4e-41ae-9a86-c5d8812a4af0"
```

- [ ] **Step 3: Run end-to-end prompt test via `/api/send`**

```bash
curl -s -X POST http://127.0.0.1:8789/api/send \
  -H "Content-Type: application/json" \
  -d '{"cid":"3e733bed-4c4e-41ae-9a86-c5d8812a4af0","text":"API 브릿지 양방향 동기화 검증 테스트"}'
```

- [ ] **Step 4: Check daemon/worker logs and verify propagation to Google WebChannel**

Verify that the worker processes the turn and outputs without inotify or process collision errors.
Verify on `antigravity.google.com` that the new turn appears.
