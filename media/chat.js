const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => {} };
if (isBrowser) {
  window.vscode = vscode;
}

const messagesContainer = isBrowser ? document.getElementById('messages-container') : null;
const emptyState = isBrowser ? document.getElementById('empty-state') : null;
const composerInput = isBrowser ? document.getElementById('composer-input') : null;
const enterToggle = isBrowser ? document.getElementById('enter-send-toggle') : null;
const btnSend = isBrowser ? document.getElementById('btn-send') : null;
const btnClear = isBrowser ? document.getElementById('btn-clear') : null;
const btnSync = isBrowser ? document.getElementById('btn-sync') : null;
const btnCopy = isBrowser ? document.getElementById('btn-copy') : null;

const tabChat = isBrowser ? document.getElementById('tab-chat') : null;
const tabTerm = isBrowser ? document.getElementById('tab-term') : null;
const viewChat = isBrowser ? document.getElementById('view-chat') : null;
const viewTerm = isBrowser ? document.getElementById('view-term') : null;

let currentSession = null;

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanUserMessageText(raw) {
  if (!raw) return '';
  let text = String(raw);
  const reqMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (reqMatch) {
    text = reqMatch[1];
  }
  text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '');
  text = text.replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, '');
  text = text.replace(/<[^>]+>/g, '');
  return text.trim();
}

function renderMarkdown(rawText) {
  if (!rawText) return '';

  // 1. Preserve fenced code blocks
  const codeBlocks = [];
  let text = rawText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || 'text', code });
    return id;
  });

  // 2. Escape HTML
  text = escapeHtml(text);

  // 3. Headings
  text = text.replace(/^### (.*$)/gim, '<h3 class="chat-h3">$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2 class="chat-h2">$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1 class="chat-h1">$1</h1>');

  // 4. Dividers
  text = text.replace(/^(?:---|[*]{3}|_{3})\s*$/gim, '<hr class="chat-divider" />');

  // 5. Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" data-url="$2">$1</a>');

  // 6. Inline code pills
  text = text.replace(/`([^`]+)`/g, '<code class="code-pill">$1</code>');

  // 7. Bullet lists (before italic)
  text = text.replace(/^\s*[-*]\s+(.*)$/gim, '<li class="chat-li">$1</li>');
  text = text.replace(/(<li class="chat-li">[\s\S]*?<\/li>)/gim, '<ul class="chat-ul">$1</ul>');
  text = text.replace(/<\/ul>\s*<ul class="chat-ul">/gim, '');

  // 8. Bold & Italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // 9. Paragraph breaks
  text = text.replace(/\n\n+/g, '</p><p class="chat-p">');
  text = text.replace(/\n/g, '<br/>');
  text = '<p class="chat-p">' + text + '</p>';
  text = text.replace(/<p class="chat-p">\s*<\/p>/g, '');
  text = text.replace(/<p class="chat-p">(<h[1-3][^>]*>)/g, '$1');
  text = text.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  text = text.replace(/<p class="chat-p">(<hr[^>]*>)/g, '$1');
  text = text.replace(/(<hr[^>]*>)<\/p>/g, '$1');
  text = text.replace(/<p class="chat-p">(<ul[^>]*>)/g, '$1');
  text = text.replace(/(<\/ul>)<\/p>/g, '$1');

  // 10. Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    const { lang, code } = codeBlocks[i];
    const escapedCode = escapeHtml(code.trim());
    const blockHtml = `
      <div class="code-block-wrap">
        <div class="code-block-header">
          <span class="code-lang">${lang}</span>
          <button class="copy-code-btn" type="button">복사</button>
        </div>
        <pre><code class="language-${lang}">${escapedCode}</code></pre>
      </div>`;
    text = text.replace(`__CODE_BLOCK_${i}__`, blockHtml);
  }

  return text;
}

function renderTurn(turn) {
  if (turn.role === 'user') {
    const cleanContent = cleanUserMessageText(turn.content);
    if (!cleanContent) return null;

    const div = document.createElement('div');
    div.className = 'turn-item user';
    div.innerHTML = `<div class="user-bubble"><div class="user-content">${escapeHtml(cleanContent).replace(/\n/g, '<br/>')}</div></div>`;
    return div;
  }

  // Assistant turn
  const hasContent = turn.content && turn.content.trim().length > 0;
  const hasThinking = turn.thinking && turn.thinking.trim().length > 0;
  const hasTools = Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0;

  if (!hasContent && !hasThinking && !hasTools) {
    return null;
  }

  const div = document.createElement('div');
  div.className = 'turn-item assistant';

  let inner = '';

  // 1. Thinking block (sleek step summary)
  if (hasThinking) {
    inner += `
      <details class="step-indicator thinking">
        <summary class="step-summary">
          <span class="step-label">생각 과정 보기</span>
          <span class="step-chevron">›</span>
        </summary>
        <div class="step-body thinking-body">${escapeHtml(turn.thinking).replace(/\n/g, '<br/>')}</div>
      </details>`;
  }

  // 2. Tool calls (sleek step summaries matching reference image)
  if (hasTools) {
    for (const tc of turn.toolCalls) {
      const isFailed = tc.status === 'ERROR' || tc.status === 'FAILED';
      const argsDisplay = typeof tc.args === 'object' ? JSON.stringify(tc.args, null, 2) : String(tc.args);
      inner += `
        <details class="step-indicator ${isFailed ? 'failed' : ''}">
          <summary class="step-summary">
            <span class="step-label">${escapeHtml(tc.label || tc.name)}</span>
            ${isFailed ? '<span class="step-status-failed">실패</span>' : ''}
            <span class="step-chevron">›</span>
          </summary>
          <div class="step-body"><pre><code>${escapeHtml(argsDisplay)}</code></pre></div>
        </details>`;
    }
  }

  // 3. Assistant markdown body (seamless flow without card border)
  if (hasContent) {
    inner += `<div class="markdown-body">${renderMarkdown(turn.content)}</div>`;
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

  const userDiv = renderTurn({ role: 'user', content: text });
  if (userDiv) {
    messagesContainer.appendChild(userDiv);
    scrollToBottom();
  }

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
    vscode.postMessage({ command: 'termDeactivate' });
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
    const turns = messagesContainer.querySelectorAll('.turn-item');
    turns.forEach(t => {
      const isUser = t.classList.contains('user');
      fullText += `### ${isUser ? 'User' : 'Assistant'}\n${t.innerText}\n\n`;
    });
    navigator.clipboard.writeText(fullText.trim());
    const original = btnCopy.textContent;
    btnCopy.textContent = '✓';
    setTimeout(() => { btnCopy.textContent = original; }, 1500);
  };
}

// Global click delegation for links and copy buttons
if (isBrowser) {
  document.addEventListener('click', (e) => {
  // 1. Link click
  const link = e.target.closest('.chat-link');
  if (link) {
    e.preventDefault();
    const url = link.getAttribute('data-url') || link.getAttribute('href');
    if (url && window.vscode) {
      window.vscode.postMessage({ command: 'openLink', url });
    }
    return;
  }

  // 2. Copy code button
  const copyBtn = e.target.closest('.copy-code-btn');
  if (copyBtn) {
    const wrap = copyBtn.closest('.code-block-wrap');
    if (wrap) {
      const codeEl = wrap.querySelector('code');
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.innerText);
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓ 복사됨';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      }
    }
  }
});

function applyTurns(msg, isInitial) {
  currentSession = msg.session;
  const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 120;

  messagesContainer.innerHTML = '';

  if (!msg.turns || msg.turns.length === 0) {
    messagesContainer.innerHTML = '<div class="empty-state">대화 기록이 없습니다. 첫 메시지를 전송해 보세요!</div>';
    return;
  }

  if (msg.hasEarlier) {
    const wrap = document.createElement('div');
    wrap.className = 'load-earlier-wrap';
    const btnEarlier = document.createElement('button');
    btnEarlier.className = 'btn-load-earlier';
    btnEarlier.textContent = `⬆ 이전 대화 더 불러오기 (총 ${msg.totalCount}개 중 최근 ${msg.turns.length}개 표시)`;
    btnEarlier.onclick = () => {
      vscode.postMessage({ command: 'loadMoreTurns' });
    };
    wrap.appendChild(btnEarlier);
    messagesContainer.appendChild(wrap);
  }

  for (const t of msg.turns) {
    const el = renderTurn(t);
    if (el) messagesContainer.appendChild(el);
  }

  if (isInitial || isNearBottom) {
    scrollToBottom();
  }
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'initTurns') {
    applyTurns(msg, true);
  } else if (msg.type === 'updateTurns') {
    applyTurns(msg, false);
  }
});

  vscode.postMessage({ command: 'ready' });
  vscode.postMessage({ command: 'syncTurns' });
}

if (typeof module !== 'undefined') {
  module.exports = {
    escapeHtml,
    cleanUserMessageText,
    renderMarkdown,
    renderTurn
  };
}
