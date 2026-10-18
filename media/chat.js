
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

function formatDuration(sec) {
  if (sec >= 180) {
    const m = Math.round(sec / 60);
    return `${m}m`;
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${sec}s`;
}

function formatToolStep(tc) {
  const isFailed = tc.status === 'ERROR' || tc.status === 'FAILED';
  const args = tc.args || {};
  const toolName = tc.name || tc.tool_name || 'tool';

  if (toolName === 'view_file' && args.AbsolutePath) {
    const pathStr = String(args.AbsolutePath).replace(/["']/g, '');
    const filename = pathStr.split('/').pop() || 'file';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    let lineRange = '';
    if (args.StartLine && args.EndLine) {
      lineRange = `#L${args.StartLine}-${args.EndLine}`;
    } else if (args.StartLine) {
      lineRange = `#L${args.StartLine}`;
    }
    return {
      type: 'analyzed',
      ext,
      filename,
      lineRange,
      args,
      isFailed
    };
  }

  let label = tc.label || tc.toolSummary || tc.toolAction;
  if (!label) {
    if (toolName === 'run_command' && args.CommandLine) {
      label = 'Run command: ' + String(args.CommandLine).slice(0, 50).replace(/["']/g, '');
    } else {
      label = toolName;
    }
  }

  return {
    type: 'tool_action',
    label,
    args,
    isFailed
  };
}

function renderSubStepHtml(step) {
  if (step.type === 'analyzed') {
    return `
      <details class="sub-step-indicator ${step.isFailed ? 'failed' : ''}">
        <summary class="sub-step-summary">
          <span class="sub-step-label">
            Analyzed <span class="file-ext-badge ext-${escapeHtml(step.ext)}">${escapeHtml(step.ext.toUpperCase())}</span>
            <span class="analyzed-filename">${escapeHtml(step.filename)}</span>
            <span class="analyzed-range">${escapeHtml(step.lineRange)}</span>
          </span>
          <span class="step-chevron">›</span>
        </summary>
        <div class="sub-step-body"><pre><code>${escapeHtml(JSON.stringify(step.args, null, 2))}</code></pre></div>
      </details>`;
  } else if (step.type === 'tool_action') {
    const argsDisplay = typeof step.args === 'object' ? JSON.stringify(step.args, null, 2) : String(step.args || '');
    return `
      <details class="sub-step-indicator ${step.isFailed ? 'failed' : ''}">
        <summary class="sub-step-summary">
          <span class="sub-step-label">${escapeHtml(step.label)}</span>
          ${step.isFailed ? '<span class="step-status-failed">실패</span>' : ''}
          <span class="step-chevron">›</span>
        </summary>
        <div class="sub-step-body"><pre><code>${escapeHtml(argsDisplay)}</code></pre></div>
      </details>`;
  } else if (step.type === 'thought') {
    return `
      <details class="sub-step-indicator thinking">
        <summary class="sub-step-summary">
          <span class="sub-step-label">Thought for ${escapeHtml(step.duration)}</span>
          <span class="step-chevron">›</span>
        </summary>
        <div class="sub-step-body thinking-body">${escapeHtml(step.thinking).replace(/\n/g, '<br/>')}</div>
      </details>`;
  }
  return '';
}

function groupConsecutiveTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return [];

  const partitions = [];
  let currentGroup = null;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role === 'user') {
      if (currentGroup) partitions.push(currentGroup);
      partitions.push({ role: 'user', turn: t });
      currentGroup = null;
    } else {
      if (!currentGroup) {
        currentGroup = { role: 'assistant', turns: [] };
      }
      currentGroup.turns.push(t);
    }
  }
  if (currentGroup) partitions.push(currentGroup);

  const result = [];

  for (let pIdx = 0; pIdx < partitions.length; pIdx++) {
    const p = partitions[pIdx];
    if (p.role === 'user') {
      result.push(p.turn);
      continue;
    }

    const assistantTurns = p.turns;
    const isLastPartition = (pIdx === partitions.length - 1);

    const steps = [];
    let finalContent = null;
    let interimNotes = [];
    let startTime = null;
    let endTime = null;

    for (let i = 0; i < assistantTurns.length; i++) {
      const at = assistantTurns[i];
      const ts = at.timestamp || at.createdAt;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          if (!startTime) startTime = d;
          endTime = d;
        }
      }

      if (at.thinking && at.thinking.trim().length > 0) {
        const sec = Math.max(2, Math.round(at.thinking.length / 125));
        steps.push({
          type: 'thought',
          duration: `${sec}s`,
          thinking: at.thinking
        });
      }

      if (Array.isArray(at.toolCalls) && at.toolCalls.length > 0) {
        for (const tc of at.toolCalls) {
          steps.push(formatToolStep(tc));
        }
      }

      if (at.content && at.content.trim().length > 0) {
        if (i === assistantTurns.length - 1) {
          finalContent = at.content;
        } else {
          interimNotes.push(at.content);
        }
      }
    }

    let durationSec = 0;
    if (startTime && endTime) {
      durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    }
    if (durationSec <= 0) {
      const toolCount = steps.filter(s => s.type !== 'thought').length;
      durationSec = Math.max(6, toolCount * 7);
    }
    const durationFormatted = formatDuration(durationSec);

    const hasCompletedAnswer = !!finalContent;
    const isWorking = !hasCompletedAnswer && isLastPartition;

    const assistantResult = {
      role: 'assistant',
      index: assistantTurns[0] ? assistantTurns[0].index : 0,
      isWorking,
      items: []
    };

    if (isWorking) {
      // STATE B: Active / In progress (동작 중 - Image 1)
      for (const step of steps) {
        assistantResult.items.push(step);
      }
      assistantResult.items.push({ type: 'working_indicator' });
    } else {
      // STATE A: Completed / Answered (답변 완료 시 - Image 3)
      if (steps.length > 0) {
        const hasTools = steps.some(s => s.type !== 'thought');
        if (hasTools) {
          assistantResult.items.push({
            type: 'worked_group',
            duration: durationFormatted,
            steps: steps
          });
        } else {
          assistantResult.items.push({
            type: 'thought_group',
            duration: durationFormatted,
            thinking: steps.map(s => s.thinking).filter(Boolean).join('\n\n')
          });
        }
      }

      for (const note of interimNotes) {
        assistantResult.items.push({
          type: 'interim',
          content: note
        });
      }

      if (finalContent) {
        assistantResult.items.push({
          type: 'content',
          content: finalContent
        });
      }
    }

    result.push(assistantResult);
  }

  return result;
}

function renderTurn(turn) {
  if (turn.role === 'user') {
    const cleanContent = cleanUserMessageText(turn.content);
    if (!cleanContent) return null;

    if (typeof document === 'undefined') {
      return `<div class="turn-item user"><div class="user-bubble"><div class="user-content">${escapeHtml(cleanContent).replace(/\n/g, '<br/>')}</div></div></div>`;
    }

    const div = document.createElement('div');
    div.className = 'turn-item user';
    div.innerHTML = `<div class="user-bubble"><div class="user-content">${escapeHtml(cleanContent).replace(/\n/g, '<br/>')}</div></div>`;
    return div;
  }

  // Assistant turn
  const normalized = turn.items ? turn : (groupConsecutiveTurns([turn])[0] || turn);
  if (!normalized || !normalized.items || normalized.items.length === 0) {
    return null;
  }

  let inner = '';

  for (const item of normalized.items) {
    if (item.type === 'worked_group') {
      inner += `
        <details class="step-indicator worked-group">
          <summary class="step-summary">
            <span class="step-label">Worked for ${escapeHtml(item.duration)}</span>
            <span class="step-chevron">›</span>
          </summary>
          <div class="step-body worked-steps-list">
            ${item.steps.map(renderSubStepHtml).join('')}
          </div>
        </details>`;
    } else if (item.type === 'thought_group') {
      inner += `
        <details class="step-indicator thinking">
          <summary class="step-summary">
            <span class="step-label">Thought for ${escapeHtml(item.duration)}</span>
            <span class="step-chevron">›</span>
          </summary>
          <div class="step-body thinking-body">${escapeHtml(item.thinking).replace(/\n/g, '<br/>')}</div>
        </details>`;
    } else if (item.type === 'working_indicator') {
      inner += `
        <div class="working-indicator">
          <span class="working-spinner"></span>
          <span>Working</span>
        </div>`;
    } else if (item.type === 'interim') {
      inner += `<div class="assistant-interim-text">${escapeHtml(item.content)}</div>`;
    } else if (item.type === 'content') {
      inner += `<div class="markdown-body">${renderMarkdown(item.content)}</div>`;
    } else {
      inner += renderSubStepHtml(item);
    }
  }

  if (typeof document === 'undefined') {
    return `<div class="turn-item assistant">${inner}</div>`;
  }

  const div = document.createElement('div');
  div.className = 'turn-item assistant';
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

  const existingPending = document.getElementById('turn-pending-indicator');
  if (existingPending) existingPending.remove();

  const pendingDiv = document.createElement('div');
  pendingDiv.id = 'turn-pending-indicator';
  pendingDiv.className = 'turn-item assistant';
  pendingDiv.innerHTML = '<div class="working-indicator"><span class="working-spinner"></span> <span>Working</span></div>';
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
    const link = e.target.closest('.chat-link');
    if (link) {
      e.preventDefault();
      const url = link.getAttribute('data-url') || link.getAttribute('href');
      if (url && window.vscode) {
        window.vscode.postMessage({ command: 'openLink', url });
      }
      return;
    }

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

  // Seamless Reverse Infinite Scroll (스크롤 업 시 자동 추가 로딩, 화면 리프레시 없음)
  let hasEarlierTurns = false;
  let isLoadingEarlier = false;

  messagesContainer.addEventListener('scroll', () => {
    if (messagesContainer.scrollTop < 120 && hasEarlierTurns && !isLoadingEarlier) {
      isLoadingEarlier = true;
      const loader = document.getElementById('loading-earlier-indicator');
      if (loader) loader.style.display = 'flex';
      vscode.postMessage({ command: 'loadMoreTurns' });
    }
  });

  function applyTurns(msg, isInitial) {
    currentSession = msg.session;
    hasEarlierTurns = !!msg.hasEarlier;
    isLoadingEarlier = false;

    const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 120;
    messagesContainer.innerHTML = '';

    if (!msg.turns || msg.turns.length === 0) {
      messagesContainer.innerHTML = '<div class="empty-state">대화 기록이 없습니다. 첫 메시지를 전송해 보세요!</div>';
      return;
    }

    if (hasEarlierTurns) {
      const topBar = document.createElement('div');
      topBar.id = 'loading-earlier-indicator';
      topBar.className = 'loading-earlier-bar';
      topBar.innerHTML = '<span class="working-spinner"></span> 과거 대화 불러오는 중...';
      messagesContainer.appendChild(topBar);
    }

    const groupedTurns = groupConsecutiveTurns(msg.turns);
    for (const t of groupedTurns) {
      const el = renderTurn(t);
      if (el) messagesContainer.appendChild(el);
    }

    if (isInitial || isNearBottom) {
      scrollToBottom();
    }
  }

  function applyMoreTurns(msg) {
    hasEarlierTurns = !!msg.hasEarlier;
    isLoadingEarlier = false;

    const loader = document.getElementById('loading-earlier-indicator');
    if (loader) loader.style.display = 'none';

    const prevScrollHeight = messagesContainer.scrollHeight;
    const prevScrollTop = messagesContainer.scrollTop;

    messagesContainer.innerHTML = '';

    if (hasEarlierTurns) {
      const topBar = document.createElement('div');
      topBar.id = 'loading-earlier-indicator';
      topBar.className = 'loading-earlier-bar';
      topBar.innerHTML = '<span class="working-spinner"></span> 과거 대화 불러오는 중...';
      messagesContainer.appendChild(topBar);
    }

    const groupedTurns = groupConsecutiveTurns(msg.turns);
    for (const t of groupedTurns) {
      const el = renderTurn(t);
      if (el) messagesContainer.appendChild(el);
    }

    // Anchor-preserved seamless scroll: keep viewport completely stationary!
    const heightDiff = messagesContainer.scrollHeight - prevScrollHeight;
    messagesContainer.scrollTop = prevScrollTop + heightDiff;
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'initTurns') {
      applyTurns(msg, true);
    } else if (msg.type === 'updateTurns') {
      applyTurns(msg, false);
    } else if (msg.type === 'moreTurnsLoaded') {
      applyMoreTurns(msg);
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
    renderTurn,
    formatDuration,
    formatToolStep,
    renderSubStepHtml,
    groupConsecutiveTurns
  };
}
