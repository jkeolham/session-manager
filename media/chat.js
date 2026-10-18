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

if (btnSend) btnSend.onclick = doSend;
if (btnClear) btnClear.onclick = () => { composerInput.value = ''; };

if (composerInput) {
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (enterToggle && enterToggle.checked) {
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
}

if (tabChat && tabTerm) {
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
}

if (btnSync) {
  btnSync.onclick = () => {
    vscode.postMessage({ command: 'syncTurns' });
  };
}

if (btnCopy) {
  btnCopy.onclick = () => {
    let fullText = '';
    const bubbles = messagesContainer.querySelectorAll('.turn-bubble');
    bubbles.forEach(b => {
      const isUser = b.classList.contains('user');
      fullText += `### ${isUser ? 'User' : 'Assistant'}\n${b.innerText}\n\n`;
    });
    navigator.clipboard.writeText(fullText.trim());
    const original = btnCopy.textContent;
    btnCopy.textContent = '✓';
    setTimeout(() => { btnCopy.textContent = original; }, 1500);
  };
}

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

// Export helpers if in node test environment
if (typeof module !== 'undefined') {
  module.exports = {
    escapeHtml,
    renderSimpleMarkdown,
    renderTurn
  };
}
