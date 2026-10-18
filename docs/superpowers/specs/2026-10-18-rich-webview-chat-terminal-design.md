# Rich Webview Chat & Web Terminal Frontend Design Specification

- **Date**: 2026-10-18
- **Project**: N100 Session Manager (`ttolmany.session-manager`)
- **Version Target**: v1.1.0
- **Status**: Approved & Ready for Implementation Plan

---

## 1. Overview & Problem Statement

### 1.1 Background
The current `session-manager` VS Code extension attaches to remote control AI sessions (`agy --conversation=<cid>`) and regular `tmux` sessions via an integrated PTY terminal (`tmux attach-session`). 

### 1.2 Problems with Current Terminal-Based Flow
1. **Raw Terminal Limitations**: Character-stream PTY terminals cannot support native GUI text editing:
   - Partial mouse drag selection cannot be replaced or deleted via Backspace/Delete.
   - `Shift + Arrow` character-by-character selection does not function as a standard Windows GUI textbox.
   - Output is unformatted terminal text lacking rich markdown, syntax-highlighted code blocks with copy buttons, and structured collapsible tool calls.
2. **Context Switching**: Interacting with an AI assistant in a raw terminal pane feels disjointed and clunky compared to modern AI chat interfaces (ChatGPT, Claude.ai, or Antigravity chat).

### 1.3 Solution
Completely replace the direct terminal attachment with a **Custom Webview Editor Tab (`SessionChatPanelManager`)** running inside Antigravity IDE:
1. **Primary View (`💬 AI 대화창`)**: Modern, rich markdown chat interface:
   - Renders structured conversation history from `transcript.jsonl`.
   - Syntax-highlighted code blocks with 1-click copy buttons.
   - Collapsible tool execution blocks (`🛠️ run_command`, `file_edit`, etc.) and thinking process accordions.
   - Full Windows-style rich composer supporting mouse drag selection/deletion, `Shift+Arrow` selection, `Ctrl+C/V/X`, multiline growth, and configurable Enter-to-send.
2. **Secondary View (`💻 콘솔 터미널`)**: Embedded `xterm.js` terminal canvas for direct tmux console interaction when raw CLI output or terminal interaction is needed.

---

## 2. Architecture & Component Design

### 2.1 High-Level Architecture
```
+-----------------------------------------------------------------------------------+
| Antigravity IDE (VS Code Extension Host)                                          |
|                                                                                   |
|  [Sessions Sidebar] (TreeDataProvider)                                            |
|    |                                                                              |
|    +--> User clicks session -> sessionManager.openChatView(cid, title, type)     |
|                                     |                                             |
|                                     v                                             |
|                        [SessionChatPanelManager]                                  |
|                                     |                                             |
|                     +---------------+---------------+                             |
|                     |                               |                             |
|                     v                               v                             |
|          WebviewPanel Tab 1              WebviewPanel Tab 2                       |
|        ([cc0d] JKNAS 뮤직라이브러리)    (agy_asset_TAX)                           |
|         +-------------------------------------------------------------+           |
|         | Header: Title [cc0d] | Tabs: [💬 AI 대화창] [💻 콘솔 터미널] |           |
|         | Actions: [🔄 동기화] [📋 복사] [🗑️ 삭제]                      |           |
|         +-------------------------------------------------------------+           |
|         | Tab 1: AI Chat View           | Tab 2: Terminal View        |           |
|         |  - User bubble                |  - xterm.js canvas          |           |
|         |  - Assistant markdown bubble  |  - Auto-fit addon           |           |
|         |  - Code blocks + Copy button  |  - Windows drag/paste       |           |
|         |  - Tool call <details>        |                             |           |
|         |  - Rich Multiline Composer    |                             |           |
|         +-------------------------------+-----------------------------+           |
+-----------------------------------------------------------------------------------+
                                      |
                     IPC Messages (postMessage / onDidReceiveMessage)
                                      |
                                      v
+-----------------------------------------------------------------------------------+
| Extension Backend Services                                                        |
|                                                                                   |
| 1. TranscriptWatcher:                                                             |
|    - Monitors ~/.gemini/antigravity-ide/brain/<cid>/.system_generated/logs/       |
|    - Parses transcript.jsonl (USER_INPUT, PLANNER_RESPONSE)                       |
|    - Streams delta turns to Webview via postMessage({ type: 'appendTurn' })       |
|                                                                                   |
| 2. PromptDispatcher:                                                              |
|    - Receives { command: 'sendPrompt', cid, text }                                |
|    - Dispatches to tmux session rc_<cid> via tmux load-buffer & paste-buffer -p   |
|                                                                                   |
| 3. TerminalStreamBridge:                                                          |
|    - Bridges xterm.js data to/from tmux pane (capture-pane / send-keys)          |
|                                                                                   |
| 4. SessionDiscovery:                                                              |
|    - Reads conversation_summaries.db and tmux list-panes                          |
+-----------------------------------------------------------------------------------+
```

---

## 3. Data Ingestion & Pipeline Specification

### 3.1 Transcript Storage Format (`transcript.jsonl`)
The transcript lines are JSONL formatted:
```json
{"step_index":1,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","content":"프롬프트 텍스트"}
{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"답변 마크다운 텍스트","tool_calls":[{"tool_name":"run_command","args":{"CommandLine":"pytest"}}],"thinking":"사고 과정 텍스트"}
```

### 3.2 Turn Parsing & Transformation
When opening a session:
1. Extension reads `transcript.jsonl` from disk.
2. Formats each step into a unified `ChatTurn` object:
   ```typescript
   interface ChatTurn {
     index: number;
     role: 'user' | 'assistant';
     content: string; // Markdown text
     toolCalls?: Array<{
       name: string;
       action?: string;
       summary?: string;
       args?: Record<string, any>;
     }>;
     thinking?: string;
     timestamp?: string;
   }
   ```
3. If `transcript.jsonl` has more than 30 turns:
   - Initially transmits the latest 30 turns to minimize memory overhead.
   - Provides a `hasEarlier: true` flag to enable the `⬆️ 이전 대화 더 불러오기` button.

### 3.3 Prompt Submission Pipeline
When user sends a prompt:
1. Webview immediately renders the user bubble optimistically and adds an animated pulse indicator ("생각하는 중...").
2. Webview posts message to extension host: `{ command: 'sendPrompt', cid, text }`.
3. Extension host writes `text` to temp buffer file, loads into `tmux load-buffer`, and issues:
   - `tmux paste-buffer -p -t "rc_<cid>"`
   - `tmux send-keys -t "rc_<cid>" Enter`
4. Extension file watcher detects modification in `transcript.jsonl` and streams the resulting `PLANNER_RESPONSE` turn back to the Webview.

---

## 4. Webview UI & Component Specifications

### 4.1 Header Bar
- Title: Display session title with short CID badge `[cc0d]`.
- Status Indicator: Green dot for active/running, gray dot for completed/idle.
- Tab Switcher:
  - Button `💬 AI 대화창` (active by default for remote control sessions)
  - Button `💻 콘솔 터미널` (active by default for shell/tmux sessions)
- Action Buttons:
  - `🔄 동기화 (Sync)`: Re-reads transcript and syncs latest turns.
  - `📋 대화 복사 (Copy Transcript)`: Copies full markdown transcript to clipboard.
  - `🗑️ 세션 삭제 (Delete)`: Triggers modal confirmation adhering to Global Iron Rule 1.

### 4.2 AI Chat View
- **User Bubble**: Aligned right, subtle accent background (`var(--vscode-button-background)` with opacity), clean typography.
- **Assistant Bubble**: Aligned left, clear markdown formatting:
  - Headers, bold, italics, lists, blockquotes.
  - **Syntax-Highlighted Code Blocks**: Fenced blocks formatted with language tag and a top-right `📋 복사` button.
  - **Tool Execution Accordion (`<details>`)**:
    - Summary title: `🛠️ [도구명] 요약`
    - Body: pre-formatted execution arguments and status.
  - **Thinking Process Accordion (`<details>`)**:
    - Summary title: `🧠 생각 과정 보기`
    - Body: Gray italicized thought chain.

### 4.3 Rich Prompt Composer
- **Input Area**: Textarea styled with VS Code theme variables (`--vscode-input-background`, `--vscode-input-foreground`, `--vscode-focusBorder`).
- **Editing Capabilities**:
  - Full mouse drag selection; Backspace/Delete deletes selection cleanly.
  - `Shift + Arrow keys` expands/shrinks selection.
  - `Ctrl + C`, `Ctrl + X`, `Ctrl + V`, `Ctrl + A`, `Ctrl + Z`.
  - Automatic vertical resizing (min 80px, max 260px).
- **Controls**:
  - `[✓] Enter 전송 (Shift+Enter 줄바꿈)` checkbox toggle.
  - `지우기` button.
  - `전송 🚀` button.
  - History drawer and empty-state Up/Down arrow history recall.

### 4.4 Web Terminal View (`xterm.js`)
- Integrated `xterm.js` canvas with `xterm-addon-fit`.
- Styled using `'D2Coding', 'Cascadia Mono', monospace` font.
- Drag-to-copy and right-click-to-paste.
- Synchronized terminal resizing via `fitAddon` and `tmux resize-window`.

---

## 5. Reliability, Security & Lifecycle Management

### 5.1 Delete Safety Principle (Global Iron Rule 1)
- Deleting any session requires an explicit modal confirmation dialog detailing:
  - Target conversation ID and title.
  - Blast Radius: Permanent deletion of conversation history and database records.
  - Safe bounds: Workspace files and git commits are untouched.
- Deletion is only executed upon explicit user confirmation.

### 5.2 Session Persistence
- Closing a Webview tab merely disposes the view; background tmux sessions and running agent jobs continue uninhibited.
- Reopening the session restores the complete conversation history seamlessly.

### 5.3 Offline / Air-Gapped Asset Bundling
- All CSS, JavaScript, fonts, and icon assets are packaged directly into the `.vsix` file.
- Zero external CDN dependencies to ensure reliable offline operation.

---

## 6. Implementation Stages & Verification Criteria

1. **Stage 1: Core Panel Manager & Webview Shell**
   - Register `SessionChatPanelManager`.
   - Implement header bar, tab switching, and theme styling.
2. **Stage 2: Transcript Parser & Markdown Chat View**
   - Implement `transcript.jsonl` reader and turn streaming.
   - Implement markdown rendering, code block copy button, tool accordions.
3. **Stage 3: Rich Prompt Composer & tmux Send Pipeline**
   - Connect composer to tmux bracketed paste pipeline.
   - Verify bidirectional prompt-response cycle.
4. **Stage 4: Embedded Web Terminal (`xterm.js`)**
   - Embed xterm.js in the terminal tab.
   - Connect PTY/tmux stream bridge and verify responsive resizing.
5. **Stage 5: Packaging & Release v1.1.0**
   - Run test suite (`test-discovery.js`).
   - Package `session-manager-1.1.0.vsix`.
   - Deploy to `~/.antigravity-ide-server/extensions/`.
   - Commit and push to GitHub `jkeolham/session-manager` and upload release asset.
