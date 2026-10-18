
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

function parseMarkdownAlerts(text, alertBlocks) {
  const alertRegex = /^>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n((?:^>[ \t]?.*(?:\r?\n|$))*)/gim;

  return text.replace(alertRegex, (match, type, body) => {
    const rawLines = body.split(/\r?\n/).map(line => line.replace(/^>[ \t]?/, '')).join('\n').trim();
    const alertType = type.toUpperCase();
    const id = `__ALERT_BLOCK_${alertBlocks.length}__`;
    alertBlocks.push({ type: alertType, raw: rawLines });
    return `\n\n${id}\n\n`;
  });
}

function parseMarkdownBlockquotes(text, quoteBlocks) {
  const bqRegex = /((?:^>[ \t]?.*(?:\r?\n|$))+)/gm;
  return text.replace(bqRegex, (match) => {
    const lines = match.split(/\r?\n/).map(line => line.replace(/^>[ \t]?/, '')).join('\n').trim();
    if (!lines) return '';
    const id = `__QUOTE_BLOCK_${quoteBlocks.length}__`;
    quoteBlocks.push(lines);
    return `\n\n${id}\n\n`;
  });
}

function parseMarkdownTables(text, tableBlocks) {
  const tableRegex = /((?:^[ \t]*\|.+?\|[ \t]*\r?\n)+(?:^[ \t]*\|[\s\-:|]+?\|[ \t]*\r?\n)(?:^[ \t]*\|.+?\|[ \t]*(?:\r?\n|$))+)/gm;

  return text.replace(tableRegex, (match) => {
    const rawLines = match.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length < 2) return match;

    const parseRow = (line) => {
      let trimmed = line.replace(/^\||\|$/g, '');
      return trimmed.split('|').map(c => c.trim());
    };

    const headerCols = parseRow(rawLines[0]);
    const alignRow = parseRow(rawLines[1]);

    const isValidSep = alignRow.every(c => /^:?-+:?$/.test(c));
    if (!isValidSep) return match;

    const rowsData = [];
    for (let r = 2; r < rawLines.length; r++) {
      rowsData.push(parseRow(rawLines[r]));
    }

    const alignments = alignRow.map((c, colIdx) => {
      if (c.startsWith(':') && c.endsWith(':')) return 'center';
      if (c.endsWith(':')) return 'right';
      const colVals = rowsData.map(r => r[colIdx] || '');
      const maxLen = Math.max(0, ...colVals.map(v => v.length));
      const hasNarrative = colVals.some(v => v.includes(',') || v.length > 22);
      if (!hasNarrative && maxLen > 0 && maxLen <= 22) {
        return 'center';
      }
      return 'left';
    });

    const formatCell = (str) => {
      let s = escapeHtml(str);
      // Unescape <br> or <br/> so line breaks inside cells render as actual HTML line breaks!
      s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br/>');
      s = s.replace(/`([^`]+)`/g, '<code class="code-pill">$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" data-url="$2">$1</a>');
      return s;
    };

    let html = '<div class="table-container"><table class="chat-table"><thead><tr>';
    for (let c = 0; c < headerCols.length; c++) {
      const align = alignments[c] || 'left';
      html += `<th style="text-align:${align};">${formatCell(headerCols[c])}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < rowsData.length; r++) {
      const cols = rowsData[r];
      html += '<tr>';
      for (let c = 0; c < headerCols.length; c++) {
        const align = alignments[c] || 'left';
        const val = cols[c] !== undefined ? cols[c] : '';
        html += `<td style="text-align:${align};">${formatCell(val)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    const id = `__TABLE_BLOCK_${tableBlocks.length}__`;
    tableBlocks.push(html);
    return `\n\n${id}\n\n`;
  });
}

function renderMarkdown(rawText) {
  if (!rawText) return '';

  // 1. Extract code blocks
  const codeBlocks = [];
  let text = rawText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || 'text', code: escapeHtml(code.trim()) });
    return `\n\n${id}\n\n`;
  });

  // 2. Extract GitHub Alerts (> [!TIP])
  const alertBlocks = [];
  text = parseMarkdownAlerts(text, alertBlocks);

  // 3. Extract standard blockquotes (> quote)
  const quoteBlocks = [];
  text = parseMarkdownBlockquotes(text, quoteBlocks);

  // 4. Extract markdown tables
  const tableBlocks = [];
  text = parseMarkdownTables(text, tableBlocks);

  // 5. Escape HTML on remaining text
  text = escapeHtml(text);

  // 6. Headings
  text = text.replace(/^### (.*$)/gim, '<h3 class="chat-h3">$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2 class="chat-h2">$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1 class="chat-h1">$1</h1>');

  // 7. Dividers
  text = text.replace(/^(?:---|[*]{3}|_{3})\s*$/gim, '<hr class="chat-divider" />');

  // 8. Links & pills
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" data-url="$2">$1</a>');
  text = text.replace(/`([^`]+)`/g, '<code class="code-pill">$1</code>');

  // 9. Bullet lists
  text = text.replace(/^\s*[-*]\s+(.*)$/gim, '<li class="chat-li">$1</li>');
  text = text.replace(/(<li class="chat-li">[\s\S]*?<\/li>)/gim, '<ul class="chat-ul">$1</ul>');
  text = text.replace(/<\/ul>\s*<ul class="chat-ul">/gim, '');

  // 10. Bold & Italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // 11. Paragraph handling
  const blocks = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const processed = blocks.map(b => {
    if (/^(?:<h[1-3]|<hr|<ul|__ALERT_BLOCK_|__QUOTE_BLOCK_|__TABLE_BLOCK_|__CODE_BLOCK_)/.test(b)) {
      return b;
    }
    return '<p class="chat-p">' + b.replace(/\n/g, '<br/>') + '</p>';
  });
  text = processed.join('\n');

  // 12. Restore Alert Blocks (Antigravity Style)
  for (let i = 0; i < alertBlocks.length; i++) {
    const { type, raw } = alertBlocks[i];
    const typeClass = type.toLowerCase();
    const renderedBody = renderMarkdown(raw);
    const alertHtml = `
      <div class="chat-alert alert-${typeClass}">
        <div class="alert-type">${type}</div>
        <div class="alert-content">${renderedBody}</div>
      </div>`;
    text = text.replace(`__ALERT_BLOCK_${i}__`, alertHtml);
  }

  // 13. Restore Standard Blockquotes (Enclosed Callout Card)
  for (let i = 0; i < quoteBlocks.length; i++) {
    const raw = quoteBlocks[i];
    const renderedBody = renderMarkdown(raw);
    const bqHtml = `<blockquote class="chat-quote">${renderedBody}</blockquote>`;
    text = text.replace(`__QUOTE_BLOCK_${i}__`, bqHtml);
  }

  // 14. Restore Tables
  for (let i = 0; i < tableBlocks.length; i++) {
    text = text.replace(`__TABLE_BLOCK_${i}__`, tableBlocks[i]);
  }

  // 15. Restore Code Blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    const { lang, code } = codeBlocks[i];
    const blockHtml = `
      <div class="code-block-wrap">
        <div class="code-block-header">
          <span class="code-lang">${lang}</span>
          <button class="copy-code-btn" type="button">복사</button>
        </div>
        <pre><code class="language-${lang}">${code}</code></pre>
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

  // Visual pending indicator
  const existingPending = document.getElementById('turn-pending-indicator');
  if (existingPending) existingPending.remove();

  const pendingDiv = document.createElement('div');
  pendingDiv.id = 'turn-pending-indicator';
  pendingDiv.className = 'turn-item assistant';
  pendingDiv.innerHTML = '<div class="markdown-body" style="color:var(--text-muted);font-size:12.5px;padding:4px 0;"><span style="color:#10b981;">●</span> AI 응답을 생성하고 있습니다...</div>';
  messagesContainer.appendChild(pendingDiv);
  scrollToBottom();

  const sessionSelect = document.getElementById('session-select');
  const target = sessionSelect ? sessionSelect.value : null;

  vscode.postMessage({
    command: 'sendPrompt',
    text: text,
    target: target
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
    parseMarkdownTables,
    renderMarkdown,
    renderTurn
  };
}
