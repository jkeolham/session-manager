# Mobile Web Chat Interface & Background Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 24/7 background web service and mobile-optimized chat interface for the N100 Session Manager, allowing the user to view and interact with all 31 active AI sessions from a smartphone over Tailscale.

**Architecture:** A lightweight Node.js HTTP/SSE server (`server.mjs`) reuses existing `session-discovery.js` and `transcript-parser.js` modules, listens on port 8789 (accessible over Tailscale `100.88.152.120:8789`), streams real-time AI transcripts via Server-Sent Events, dispatches user prompts to tmux sessions via paste-buffer, and serves a responsive dark-mode mobile web application from `public/`. A `systemd --user` service ensures 24/7 uptime on N100 without requiring the desktop IDE to remain open.

**Tech Stack:** Node.js (stdlib `node:http`, `node:fs`, `node:child_process`, `node:path`), Vanilla JS/CSS (Responsive Mobile SPA, PWA meta tags, SSE client, visualViewport API), Linux systemd user daemon.

**Spec:** [docs/superpowers/specs/2026-10-19-mobile-web-chat-interface-design.md](file:///home/ttolmany/.local/share/session-manager/docs/superpowers/specs/2026-10-19-mobile-web-chat-interface-design.md)

## Global Constraints

- Backend must use only Node.js standard library (no heavy frameworks like Express or external npm dependencies).
- Default port is `8789`, configurable via `PORT` and `BIND_HOST` environment variables.
- Direct reuse of `session-discovery.js` and `transcript-parser.js` without duplicating discovery or parsing logic.
- Mobile client must be self-contained in `public/` (HTML, CSS, JS) with zero build steps or bundlers.
- Prompts dispatched to tmux must use `tmux load-buffer` + `paste-buffer -p` to prevent quote/escaping corruption and typing lag.

## Review Focus

1. **Multiline / Quoted prompt escaping**: Sending prompts with double quotes, newlines, and shell characters must not break tmux input or execute unwanted shell commands.
2. **SSE Reconnection Resilience**: When mobile switches networks or sleeps, the SSE connection must auto-reconnect without duplicating chat turns.
3. **Missing or Stale Session Handling**: Requesting a session that closed or lacks a transcript must return a clean empty state or error instead of crashing the server.
4. **Mobile Virtual Keyboard Ergonomics**: On Android Chrome/Samsung Internet, opening the keyboard must adjust the viewport without covering the chat history or input bar.
5. **No Token/Login Lockout**: Tailscale IP authorization is the sole gate; opening the URL must immediately land in the session list with zero redirects or credentials prompts.

---

### Task 1: Core Web Server & REST API (`server.mjs`)

**Files:**
- Create: `server.mjs`
- Test: `test/test-server-api.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `session-discovery.js::listSessions()`, `transcript-parser.js::parseTranscript()`
- Produces: HTTP API on `http://<host>:8789`:
  - `GET /api/sessions`: Returns `{ agy: [...], claude: [...], codex: [...], others: [...] }`
  - `GET /api/transcript?cid=<cid>&type=<type>&session=<session>`: Returns `{ session, cid, turns: [...] }`
  - `POST /api/send`: Body `{ session, cid, text }` -> returns `{ ok: true }`
  - `GET /` and static paths: Serves files from `public/`

- [ ] **Step 1: Write failing test for server REST API**

Create `test/test-server-api.js`:
```javascript
const { createServer } = require('../server.mjs');
const http = require('http');
const assert = require('assert');

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 8799,
      path,
      ...options,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function run() {
  const server = await createServer({ port: 8799, bindHost: '127.0.0.1' });
  try {
    // 1. GET /api/sessions
    const resSessions = await request('/api/sessions');
    assert.strictEqual(resSessions.status, 200);
    const sessions = JSON.parse(resSessions.body);
    assert(Array.isArray(sessions.agy), 'sessions.agy should be an array');
    assert(Array.isArray(sessions.claude), 'sessions.claude should be an array');

    // 2. GET /api/transcript with invalid query
    const resInvalid = await request('/api/transcript');
    assert.strictEqual(resInvalid.status, 400);

    // 3. POST /api/send with missing fields
    const resSendInvalid = await request('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resSendInvalid.status, 400);

    console.log('✅ test-server-api passed!');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ test-server-api failed:', err);
  process.exit(1);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test/test-server-api.js`
Expected: FAIL with "Cannot find module '../server.mjs'".

- [x] **Step 3: Implement `server.mjs` core and API endpoints**

Create `server.mjs` supporting CommonJS and ES modules:
- Reads `PORT` (default 8789) and `BIND_HOST` (default 0.0.0.0).
- Handlers for `/api/sessions`, `/api/transcript`, `/api/send`.
- Dispatches prompts to tmux panes using `tmux set-buffer` + `tmux paste-buffer -p -t <session>`.
- Serves static files from `public/` directory with proper MIME types (`text/html`, `text/css`, `text/javascript`, `image/svg+xml`).
- Exports `createServer(options)` for testing and auto-starts when run directly (`node server.mjs`).

- [x] **Step 4: Run test to verify it passes**

Run: `node test/test-server-api.js`
Expected: PASS with "✅ test-server-api passed!".

- [x] **Step 5: Commit Task 1**

```bash
git add server.mjs test/test-server-api.js package.json
git commit -m "feat(server): implement core HTTP server and REST endpoints for mobile access"
```

---

### Task 2: Real-time Server-Sent Events (SSE) Streaming (`/api/stream`)

**Files:**
- Modify: `server.mjs`
- Test: `test/test-server-stream.js`

**Interfaces:**
- Consumes: File system changes in `~/.gemini/antigravity-cli/brain/<cid>/.system_generated/logs/transcript.jsonl`
- Produces: `GET /api/stream?cid=<cid>&session=<session>` SSE stream emitting `event: turn` and `event: ping`.

- [x] **Step 1: Write failing test for SSE streaming**

Create `test/test-server-stream.js`:
```javascript
const { createServer } = require('../server.mjs');
const http = require('http');
const assert = require('assert');

async function run() {
  const server = await createServer({ port: 8798, bindHost: '127.0.0.1' });
  try {
    const req = http.request({
      host: '127.0.0.1',
      port: 8798,
      path: '/api/stream?cid=test-cid&session=test-sess',
      headers: { 'Accept': 'text/event-stream' }
    });

    const receivedChunks = await new Promise((resolve, reject) => {
      let data = '';
      req.on('response', res => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-type'], 'text/event-stream');
        res.on('data', chunk => {
          data += chunk.toString();
          if (data.includes('event: connected') || data.includes('event: ping')) {
            req.destroy();
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    assert(receivedChunks.includes('event:'), 'Stream should emit event headers');
    console.log('✅ test-server-stream passed!');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ test-server-stream failed:', err);
  process.exit(1);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test/test-server-stream.js`
Expected: FAIL (404 or connection closed because `/api/stream` is not yet implemented).

- [x] **Step 3: Implement SSE streaming logic in `server.mjs`**

- In `server.mjs`, handle `req.url.startsWith('/api/stream')`:
  - Set SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
  - Send immediate `event: connected\ndata: {}\n\n`.
  - Set up a 25-second heartbeat timer sending `event: ping\ndata: {}\n\n`.
  - Watch transcript file for the given `cid`. When file changes, parse newly appended lines and emit `event: turn\ndata: <JSON>\n\n`.
  - Clean up watchers and heartbeat interval when request closes (`req.on('close')`).

- [x] **Step 4: Run test to verify it passes**

Run: `node test/test-server-stream.js`
Expected: PASS with "✅ test-server-stream passed!".

- [x] **Step 5: Commit Task 2**

```bash
git add server.mjs test/test-server-stream.js
git commit -m "feat(server): add Server-Sent Events stream for real-time mobile transcript updates"
```

---

### Task 3: Mobile Web Frontend (`public/index.html`, `public/mobile.css`, `public/mobile.js`)

**Files:**
- Create: `public/index.html`
- Create: `public/mobile.css`
- Create: `public/mobile.js`
- Test: `test/test-mobile-ui-assets.js`

**Interfaces:**
- Consumes: `/api/sessions`, `/api/transcript`, `/api/stream`, `/api/send`
- Produces: Complete mobile web UI rendered in smartphone browsers.

- [x] **Step 1: Write test validating mobile UI assets**

Create `test/test-mobile-ui-assets.js`:
```javascript
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function run() {
  const htmlPath = path.join(__dirname, '../public/index.html');
  const cssPath = path.join(__dirname, '../public/mobile.css');
  const jsPath = path.join(__dirname, '../public/mobile.js');

  assert(fs.existsSync(htmlPath), 'index.html should exist');
  assert(fs.existsSync(cssPath), 'mobile.css should exist');
  assert(fs.existsSync(jsPath), 'mobile.js should exist');

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.includes('viewport'), 'index.html must include viewport meta tag');
  assert(html.includes('drawer'), 'index.html must include drawer for sessions');
  assert(html.includes('chat-container'), 'index.html must include chat container');
  assert(html.includes('composer'), 'index.html must include message composer');

  const css = fs.readFileSync(cssPath, 'utf8');
  assert(css.includes('--safe-area-inset'), 'mobile.css should handle safe area');
  assert(css.includes('bubble'), 'mobile.css should style chat bubbles');

  const js = fs.readFileSync(jsPath, 'utf8');
  assert(js.includes('EventSource'), 'mobile.js should subscribe via EventSource');
  assert(js.includes('/api/sessions'), 'mobile.js should fetch sessions');
  assert(js.includes('/api/send'), 'mobile.js should post messages');

  console.log('✅ test-mobile-ui-assets passed!');
}

run();
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test/test-mobile-ui-assets.js`
Expected: FAIL because `public/` files do not exist yet.

- [x] **Step 3: Implement `public/index.html`**

- Responsive HTML5 shell with PWA meta tags (`theme-color`, `apple-mobile-web-app-capable`).
- Top app bar: Hamburger button (`☰`), Session title + type badge, Refresh button (`🔄`).
- Slide-out Session Drawer: categorized sections (Antigravity CLI, Claude Code, Codex, Others) with search/filter.
- Chat message area: `#messages` list with auto-scroll down on new turn.
- Sticky Composer: auto-expanding textarea, touch send button (`➤`).

- [x] **Step 4: Implement `public/mobile.css`**

- Dark theme inspired by Antigravity IDE (rich dark backgrounds, smooth contrast).
- Mobile safe-area insets (`env(safe-area-inset-bottom)`).
- Visual feedback on tap, custom scrollbars, code block styling with sticky header and copy button.
- Smooth slide drawer animation with backdrop blur.

- [x] **Step 5: Implement `public/mobile.js`**

- Fetches and renders sessions in the drawer.
- Selected session state management (`localStorage.getItem('active_session')`).
- Loads initial transcript via `/api/transcript`.
- Establishes SSE connection via `/api/stream` with automatic reconnect on network drop.
- Markdown renderer (bold, italic, list, inline code, code blocks with copy buttons, collapsible tool calls).
- Composer handler: `Enter` to send (with Shift+Enter for newline) or tap `➤` button.
- `window.visualViewport` listener keeping composer above virtual keyboard.

- [x] **Step 6: Run test to verify it passes**

Run: `node test/test-mobile-ui-assets.js`
Expected: PASS with "✅ test-mobile-ui-assets passed!".

- [x] **Step 7: Commit Task 3**

```bash
git add public/index.html public/mobile.css public/mobile.js test/test-mobile-ui-assets.js
git commit -m "feat(ui): implement responsive mobile web chat client and drawer navigation"
```

---

### Task 4: Systemd Service Unit & Deployment Integration

**Files:**
- Create: `session-manager-web.service`
- Create: `scripts/install-service.sh`
- Modify: `package.json`

**Interfaces:**
- Produces: Systemd user service `session-manager-web.service` registered and running on N100 port 8789.

- [x] **Step 1: Create systemd unit file `session-manager-web.service`**

```ini
[Unit]
Description=Antigravity Session Manager Mobile Web Service
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/ttolmany/.local/share/session-manager
ExecStart=/usr/bin/node /home/ttolmany/.local/share/session-manager/server.mjs
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production
Environment=PORT=8789
Environment=BIND_HOST=0.0.0.0

[Install]
WantedBy=default.target
```

- [x] **Step 2: Create automated installer script `scripts/install-service.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="session-manager-web.service"
TARGET_DIR="$HOME/.config/systemd/user"
SOURCE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/$SERVICE_NAME"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_FILE" "$TARGET_DIR/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "✅ $SERVICE_NAME installed and started successfully!"
systemctl --user status "$SERVICE_NAME" --no-pager
```

- [x] **Step 3: Run all automated tests**

Run:
```bash
node test/test-server-api.js
node test/test-server-stream.js
node test/test-mobile-ui-assets.js
```
Expected: All tests pass.

- [x] **Step 4: Deploy and verify service on N100**

Run:
```bash
chmod +x scripts/install-service.sh
./scripts/install-service.sh
curl -s http://127.0.0.1:8789/api/sessions | head -c 100
```
Expected: Service is active (running), and curl returns valid JSON with 200 OK.

- [x] **Step 5: Commit Task 4**

```bash
git add session-manager-web.service scripts/install-service.sh package.json
git commit -m "feat(deploy): add systemd user service unit and automated deployment script"
```
