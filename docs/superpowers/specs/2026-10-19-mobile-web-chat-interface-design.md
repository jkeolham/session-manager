# Mobile Web Chat Interface & Background Server Design Specification

- **Date**: 2026-10-19
- **Project**: N100 Session Manager (`ttolmany.session-manager`)
- **Version Target**: v1.4.0
- **Status**: Approved & Ready for Implementation Plan

---

## 1. Overview & Problem Statement

### 1.1 Background
The current `session-manager` VS Code extension runs within Antigravity IDE on the N100 server (`jkeol-ubuntu`). While it provides a rich chat interface and embedded xterm terminal inside the desktop IDE, the user needs to inspect and interact with the 31 background AI sessions (Claude Code, Antigravity CLI, Codex) while away from the desktop, using a smartphone (e.g., Samsung Galaxy Z Fold 8, Tab S7) over the existing Tailscale mesh network.

### 1.2 Core Requirements & Success Criteria
1. **24/7 Always-On Service**: An independent `systemd --user` background daemon (`session-manager-web.service`) runs continuously on N100 without requiring the desktop Antigravity IDE window to remain open.
2. **Zero-Friction Access**: Bound to the N100 Tailscale IP (`100.88.152.120:8788`) and local LAN (`192.168.1.112:8788`). Because access is restricted to authenticated Tailscale nodes, no password or PIN is required—opening the bookmark or home-screen PWA icon immediately loads the interface.
3. **Mobile-First Messenger UI**: Tailored specifically for smartphones and tablets:
   - Slide-out drawer or header dropdown for selecting from all 31 sessions categorized into Antigravity, Claude Code, Codex, and Shell.
   - Rich markdown bubbles with syntax highlighting and 1-click code block copy buttons.
   - Collapsible tool execution blocks and thinking accordions.
   - Sticky bottom composer with virtual keyboard (`visualViewport`) support, autogrow text area, and large touch-friendly send button.
4. **Code Reuse (0% Duplication)**: Directly consumes the existing `session-discovery.js` and `transcript-parser.js` modules from the extension codebase.

---

## 2. Architecture & Data Flow

### 2.1 Component Architecture

```
[ Mobile Browser (z-fold8) ]
       │
       │ HTTP / Server-Sent Events (Tailscale: 100.88.152.120:8788)
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│ session-manager-web.service (Node.js http + SSE server.mjs)            │
│                                                                        │
│ 1. Static Asset Server (public/):                                      │
│    • index.html (Responsive mobile SPA, PWA meta tags)                 │
│    • mobile.css (Dark mode, touch ergonomics, virtual keyboard aware)  │
│    • mobile.js  (SSE listener, markdown rendering, drawer, composer)   │
│                                                                        │
│ 2. REST & SSE Endpoints:                                               │
│    • GET  /api/sessions   ➔ calls session-discovery.js                 │
│    • GET  /api/transcript ➔ calls transcript-parser.js                │
│    • GET  /api/stream     ➔ watches transcript.jsonl & sends SSE delta │
│    • POST /api/send       ➔ dispatches text to tmux via paste-buffer   │
│                                                                        │
│ 3. Shared Extension Modules:                                           │
│    • session-discovery.js (list-panes + conversation_summaries.db)     │
│    • transcript-parser.js (JSONL incremental turn parser)              │
│                                                                        │
│ 4. Underlying Workloads:                                               │
│    • tmux sessions (31 active sessions)                                │
│    • ~/.gemini/antigravity-cli/brain/ (AGY transcripts)                │
│    • ~/.claude/projects/ (Claude Code transcripts)                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 API Specification

#### 1. `GET /api/sessions`
Returns the categorized session list with live conversation titles.
- **Response**:
```json
{
  "agy": [
    {
      "session": "agy_fising_hojak",
      "cid": "e40880a6-20df-4c46-aa26-777857aa08a1",
      "title": "N100 서버 관리 및 모니터링",
      "type": "agy",
      "active": true
    }
  ],
  "claude": [
    {
      "session": "Tax_Asset",
      "title": "자산 및 세무 관리",
      "type": "claude",
      "active": true
    }
  ],
  "codex": [],
  "others": []
}
```

#### 2. `GET /api/transcript?cid=<cid>&type=<type>&session=<session>`
Returns the full array of parsed conversation turns for the selected session.
- **Response**:
```json
{
  "session": "agy_fising_hojak",
  "cid": "e40880a6-20df-4c46-aa26-777857aa08a1",
  "turns": [
    {
      "role": "user",
      "text": "내 랩탑 켜줘",
      "timestamp": "2026-10-16T13:53:10+09:00"
    },
    {
      "role": "assistant",
      "text": "씽크패드 랩탑으로 WoL 매직 패킷을 발송했습니다...",
      "toolCalls": [
        {
          "name": "run_command",
          "summary": "Sending WoL magic packet",
          "output": "WoL magic packet sent successfully"
        }
      ],
      "thinking": null
    }
  ]
}
```

#### 3. `GET /api/stream?cid=<cid>&session=<session>`
Establishes an HTTP Server-Sent Events (SSE) connection:
- Pushes `{ event: "turn", data: <newTurn> }` whenever `transcript.jsonl` appends a new user or planner response turn.
- Pushes `{ event: "ping", data: {} }` every 25 seconds to keep the connection alive across mobile cellular/Wi-Fi transitions.

#### 4. `POST /api/send`
Dispatches a new user prompt to the target tmux session.
- **Request Body**:
```json
{
  "session": "agy_fising_hojak",
  "cid": "e40880a6-20df-4c46-aa26-777857aa08a1",
  "text": "현재 시스템 상태 확인해줘"
}
```
- **Execution Mechanism**:
  1. Validates that the session exists in `tmux list-sessions`.
  2. Uses `tmux set-buffer` + `tmux paste-buffer -p -t <session>` and appends a newline (`Enter`).
  3. Returns `{ "ok": true }`.

---

## 3. Mobile UI/UX Design

### 3.1 Layout & Visual Components
- **Top Header**:
  - Left: Hamburger menu icon (`☰`) toggling the session drawer.
  - Center: Current session name with live status badge (🟢 Active / 🟣 Claude / 🔵 Codex).
  - Right: Quick refresh icon (`🔄`) and scroll-to-bottom shortcut.
- **Session Drawer (Slide-out Sidebar)**:
  - Accessible via swipe-right or hamburger tap.
  - Grouped accordions: Antigravity CLI, Claude Code, Codex, Others.
  - Tapping a session selects it, loads its transcript, connects the SSE stream, and auto-closes the drawer.
- **Message List (`#chat-history`)**:
  - Bubble layout: User messages right-aligned (accent color), Assistant messages left-aligned (dark card background).
  - Markdown parsed client-side with syntax highlighting.
  - Code blocks have sticky language labels and a touch-friendly `복사` (Copy) button with haptic/visual confirmation.
  - Collapsible `<details>` for `🛠️ 도구 실행` (`tool_calls`) and `💭 생각 과정` (`thinking`).
- **Sticky Bottom Composer**:
  - `textarea` with `rows="1"` that expands up to 5 lines dynamically.
  - Large circular Send button (`➤`) enabled when text is non-empty.
  - Virtual keyboard ergonomics: Uses `window.visualViewport.addEventListener('resize')` to adjust composer position above the soft keyboard on Android Chrome/Samsung Internet without covering the chat history.

---

## 4. Systemd Service Specification

File: `~/.config/systemd/user/session-manager-web.service`

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
Environment=PORT=8788
Environment=BIND_HOST=0.0.0.0

[Install]
WantedBy=default.target
```

---

## 5. Security & Isolation

1. **Network Binding**:
   - Listens on Port `8788`.
   - Accessible over Tailscale IP `100.88.152.120:8788` and local home LAN `192.168.1.112:8788`.
   - Not exposed to the public Internet (no port-forwarding on router required).
2. **Input Validation**:
   - `POST /api/send` limits maximum text length to 64KB.
   - Session names are sanitized to prevent shell injection (alphanumeric, underscore, dash only).

---

## 6. Verification & Test Plan

1. **Unit Tests**:
   - Test `server.mjs` REST API endpoints (`/api/sessions`, `/api/transcript`, `/api/send`) using Node test runner.
   - Verify input sanitization and error handling.
2. **Integration Verification**:
   - Start the service via `systemctl --user start session-manager-web.service`.
   - Test HTTP response and SSE stream from local CLI (`curl -N http://127.0.0.1:8788/api/stream?...`).
   - Open `http://100.88.152.120:8788` on smartphone (z-fold8) over Tailscale.
   - Verify session switching, markdown rendering, code block copy, and prompt sending to a live tmux session.
