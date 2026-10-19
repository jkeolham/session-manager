(function () {
  'use strict';

  // Elements
  const headerTitle = document.getElementById('current-session-title');
  const headerBadge = document.getElementById('current-session-badge');
  const headerSubtitle = document.getElementById('current-session-subtitle');
  const drawer = document.getElementById('drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const sessionListEl = document.getElementById('session-list');
  const sessionCountBadge = document.getElementById('session-count-badge');
  const sessionSearchInput = document.getElementById('session-search');
  const chatContainer = document.getElementById('chat-container');
  const chatHistory = document.getElementById('chat-history');
  const emptyState = document.getElementById('empty-state');
  const composerInput = document.getElementById('composer-input');
  const btnSend = document.getElementById('btn-send');
  const btnScrollBottom = document.getElementById('btn-scroll-bottom');
  const filePicker = document.getElementById('file-picker');
  const btnAttach = document.getElementById('btn-attach');
  const attachmentPreviewBar = document.getElementById('attachment-preview-bar');

  let allSessions = { agy: [], claude: [], codex: [], other: [] };
  let currentSession = null;
  let activeEventSource = null;
  let isAutoScroll = true;
  let pendingAttachments = [];

  // --- Utility Functions ---

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(rawText) {
    if (!rawText) return '';
    let text = String(rawText);

    // 1. Code blocks with copy button
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      const cleanLang = lang.trim() || 'code';
      const cleanCode = code.replace(/\n$/, '');
      const blockHtml = `
        <div class="code-block">
          <div class="code-header">
            <span>${escapeHtml(cleanLang)}</span>
            <button class="copy-btn" onclick="window.copyCodeBlock(this)">복사</button>
          </div>
          <pre><code>${escapeHtml(cleanCode)}</code></pre>
        </div>
      `;
      codeBlocks.push(blockHtml);
      return `__CODE_BLOCK_${idx}__`;
    });

    // 2. Inline code
    text = text.replace(/`([^`\n]+)`/g, (m, c) => `<code>${escapeHtml(c)}</code>`);

    // 3. Bold & Italic
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // 4. Links
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // 5. Unordered Lists
    text = text.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // 6. Paragraphs and Line Breaks
    const paragraphs = text.split(/\n{2,}/);
    text = paragraphs
      .map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('__CODE_BLOCK_') || p.startsWith('<ul>') || p.startsWith('<details')) {
          return p;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    // Restore Code Blocks
    codeBlocks.forEach((block, idx) => {
      text = text.replace(`__CODE_BLOCK_${idx}__`, block);
    });

    return text;
  }

  window.copyCodeBlock = function (btn) {
    const codeEl = btn.closest('.code-block').querySelector('pre code');
    if (!codeEl) return;
    const text = codeEl.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.innerText;
      btn.innerText = '완료!';
      setTimeout(() => { btn.innerText = orig; }, 1500);
    }).catch(err => {
      console.error('Copy failed:', err);
    });
  };

  function scrollToBottom(force = false) {
    if (force || isAutoScroll) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // --- Drawer & Session Management ---

  function openDrawer() {
    drawer.classList.add('open');
    drawerBackdrop.classList.add('active');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerBackdrop.classList.remove('active');
  }

  async function fetchSessions() {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allSessions = {
        agy: data.agy || [],
        claude: data.claude || [],
        codex: data.codex || [],
        other: data.other || data.others || []
      };

      const total = (allSessions.agy.length + allSessions.claude.length + allSessions.codex.length + allSessions.other.length);
      sessionCountBadge.innerText = total;

      renderSessionList();
    } catch (err) {
      console.error('Failed to load sessions:', err);
      sessionListEl.innerHTML = `<div class="empty-state"><p>세션을 불러오지 못했습니다.</p></div>`;
    }
  }

  function renderSessionList(filter = '') {
    const lowerFilter = filter.toLowerCase().trim();
    let html = '';

    const categories = [
      { key: 'agy', label: 'Antigravity CLI', badgeClass: 'agy', items: allSessions.agy },
      { key: 'claude', label: 'Claude Code', badgeClass: 'claude', items: allSessions.claude },
      { key: 'codex', label: 'Codex', badgeClass: 'codex', items: allSessions.codex },
      { key: 'other', label: '기타 셸/서비스', badgeClass: 'other', items: allSessions.other }
    ];

    let hasMatches = false;

    categories.forEach(cat => {
      const filteredItems = cat.items.filter(item => {
        if (!lowerFilter) return true;
        const nameMatch = (item.name || '').toLowerCase().includes(lowerFilter);
        const titleMatch = (item.title || '').toLowerCase().includes(lowerFilter);
        return nameMatch || titleMatch;
      });

      if (filteredItems.length === 0) return;
      hasMatches = true;

      html += `<div class="session-category">`;
      html += `<div class="category-header">${escapeHtml(cat.label)} (${filteredItems.length})</div>`;

      filteredItems.forEach(item => {
        const isSelected = currentSession && (
          (currentSession.cid && currentSession.cid === item.cid) ||
          (currentSession.name && currentSession.name === item.name)
        );
        const activeClass = isSelected ? 'active' : '';
        const displayName = item.title || item.name;
        const subName = item.title ? item.name : (item.cid ? `cid: ${item.cid.slice(0, 8)}` : '');

        html += `
          <div class="session-item ${activeClass}" data-session="${escapeHtml(JSON.stringify(item))}">
            <div class="session-item-info">
              <div class="session-item-name">${escapeHtml(displayName)}</div>
              ${subName ? `<div class="session-item-title">${escapeHtml(subName)}</div>` : ''}
            </div>
            <span class="badge ${cat.badgeClass}">${cat.label.split(' ')[0]}</span>
          </div>
        `;
      });

      html += `</div>`;
    });

    if (!hasMatches) {
      html = `<div class="empty-state"><p>일치하는 세션이 없습니다.</p></div>`;
    }

    sessionListEl.innerHTML = html;

    // Attach click listeners
    sessionListEl.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        const dataStr = el.getAttribute('data-session');
        if (dataStr) {
          const session = JSON.parse(dataStr);
          selectSession(session);
          closeDrawer();
        }
      });
    });
  }

  // --- Select & Load Session ---

  async function selectSession(session) {
    if (!session) return;
    currentSession = session;
    localStorage.setItem('active_session', JSON.stringify(session));

    // Update Header
    headerTitle.innerText = session.title || session.name;
    headerSubtitle.innerText = session.name || (session.cid ? `cid: ${session.cid.slice(0, 8)}` : '');
    headerBadge.innerText = (session.type || 'active').toUpperCase();
    headerBadge.className = `badge ${session.type || ''}`;

    // Show Chat, Hide Empty State
    emptyState.style.display = 'none';
    chatHistory.innerHTML = '<div class="loading-spinner">대화 내역을 불러오는 중...</div>';

    // Disconnect old SSE
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    // Load initial transcript
    const cid = session.cid || '';
    const sessionName = session.name || (cid ? `rc_${cid.slice(0, 8)}` : '');

    try {
      const res = await fetch(`/api/transcript?cid=${encodeURIComponent(cid)}&session=${encodeURIComponent(sessionName)}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      chatHistory.innerHTML = '';
      if (data.turns && data.turns.length > 0) {
        const grouped = groupTurnsForDisplay(data.turns);
        grouped.forEach(turn => appendTurn(turn));
      } else if (data.terminalOutput) {
        renderTerminalScreen(data.terminalOutput, sessionName);
      } else {
        chatHistory.innerHTML = '<div class="empty-state"><p>대화 기록 및 터미널 출력이 없습니다.</p></div>';
      }
      scrollToBottom(true);
    } catch (err) {
      console.error('Failed to load transcript:', err);
      chatHistory.innerHTML = `<div class="empty-state"><p>대화 내역 로드 실패: ${escapeHtml(err.message)}</p></div>`;
    }

    // Connect SSE stream
    connectStream(cid, sessionName);
  }

  function groupTurnsForDisplay(rawTurns) {
    if (!Array.isArray(rawTurns)) return [];
    const grouped = [];

    for (const turn of rawTurns) {
      if (turn.role === 'user') {
        grouped.push({ ...turn });
      } else if (turn.role === 'assistant') {
        const prev = grouped[grouped.length - 1];
        if (prev && prev.role === 'assistant') {
          // Merge with previous assistant turn
          if (turn.thinking && typeof turn.thinking === 'string' && turn.thinking.trim()) {
            prev.thinkings = prev.thinkings || (prev.thinking ? [prev.thinking] : []);
            prev.thinkings.push(turn.thinking.trim());
            prev.thinking = turn.thinking.trim();
          }
          if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
            prev.toolCalls = (prev.toolCalls || []).concat(turn.toolCalls);
          }
          if (turn.content && typeof turn.content === 'string' && turn.content.trim()) {
            prev.content = (prev.content ? prev.content + '\n\n' : '') + turn.content.trim();
          }
          prev.timestamp = turn.timestamp || prev.timestamp;
        } else {
          grouped.push({
            ...turn,
            thinkings: turn.thinking ? [turn.thinking.trim()] : [],
            toolCalls: Array.isArray(turn.toolCalls) ? [...turn.toolCalls] : []
          });
        }
      } else {
        grouped.push({ ...turn });
      }
    }

    return grouped;
  }

  function renderTerminalScreen(text, sessionName) {
    chatHistory.innerHTML = `
      <div class="terminal-container">
        <div class="terminal-topbar">
          <span class="terminal-tag">🖥️ LIVE CONSOLE</span>
          <span class="terminal-session-name">${escapeHtml(sessionName)}</span>
          <button class="terminal-refresh-btn" type="button" id="termRefreshBtn">🔄 새로고침</button>
        </div>
        <pre class="terminal-screen" id="terminalScreen">${escapeHtml(text || '(터미널 출력이 없습니다)')}</pre>
      </div>
    `;
    const btn = document.getElementById('termRefreshBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentSession) selectSession(currentSession);
      });
    }
  }

  function buildAssistantTurnBody(turn) {
    let bodyHtml = '';

    const hasThinkings = (turn.thinkings && turn.thinkings.length > 0) || (turn.thinking && turn.thinking.trim());
    const toolList = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    const toolCount = toolList.length;
    const hasWorkProcess = hasThinkings || toolCount > 0;

    if (hasWorkProcess) {
      const parts = [];
      if (hasThinkings) {
        const count = turn.thinkings ? turn.thinkings.length : 1;
        parts.push(count > 1 ? `사고 과정 ${count}단계` : '사고 과정');
      }
      if (toolCount > 0) {
        parts.push(`도구 실행 ${toolCount}건`);
      }
      const summaryLabel = `⚙️ 작업 과정 (${parts.join(' · ')})`;

      let innerHtml = '';
      if (hasThinkings) {
        const fullThinking = turn.thinkings && turn.thinkings.length > 0
          ? turn.thinkings.join('\n\n---\n\n')
          : turn.thinking;
        innerHtml += `
          <div class="process-section">
            <div class="process-subtitle">💭 사고 과정</div>
            <div class="process-text">${escapeHtml(fullThinking)}</div>
          </div>
        `;
      }

      if (toolCount > 0) {
        innerHtml += `
          <div class="process-section">
            <div class="process-subtitle">🛠️ 도구 실행 내역 (${toolCount}건)</div>
            <div class="process-tools-list">
        `;
        toolList.forEach((tc, idx) => {
          const title = tc.label || tc.summary || tc.name || `도구 #${idx + 1}`;
          let cmdStr = '';
          if (tc.args && typeof tc.args === 'object') {
            if (tc.args.CommandLine) cmdStr = tc.args.CommandLine;
            else if (tc.args.AbsolutePath) cmdStr = tc.args.AbsolutePath;
            else if (tc.args.query) cmdStr = tc.args.query;
            else if (Object.keys(tc.args).length > 0) cmdStr = JSON.stringify(tc.args);
          }
          innerHtml += `
            <div class="process-tool-item">
              <div class="tool-item-header">
                <span class="tool-badge">${escapeHtml(tc.name || 'tool')}</span>
                <span class="tool-title">${escapeHtml(title)}</span>
              </div>
              ${cmdStr ? `<pre class="tool-cmd">${escapeHtml(cmdStr)}</pre>` : ''}
              ${tc.output ? `<pre class="tool-output">${escapeHtml(tc.output)}</pre>` : ''}
            </div>
          `;
        });
        innerHtml += `
            </div>
          </div>
        `;
      }

      bodyHtml += `
        <details class="work-process-block">
          <summary class="work-process-summary">
            <span class="work-process-label">${escapeHtml(summaryLabel)}</span>
          </summary>
          <div class="work-process-body">
            ${innerHtml}
          </div>
        </details>
      `;
    }

    const content = turn.content || turn.text || '';
    if (content.trim()) {
      bodyHtml += `<div class="turn-markdown">${renderMarkdown(content)}</div>`;
    } else if (!hasWorkProcess) {
      bodyHtml += `<div class="turn-markdown empty-content">(내용 없음)</div>`;
    }

    return bodyHtml;
  }

  function appendTurn(turn) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${turn.role || 'assistant'}`;
    msgEl.__turnData = turn;

    if (turn.role === 'user') {
      let userHtml = escapeHtml(turn.content || '');
      if (Array.isArray(turn.attachments) && turn.attachments.length > 0) {
        userHtml += `<div class="message-attachments">`;
        turn.attachments.forEach(att => {
          const isImg = (att.type && att.type.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name || att.url || '');
          if (isImg && att.url) {
            userHtml += `<img src="${att.url}" class="msg-attach-img" alt="${escapeHtml(att.name || 'image')}">`;
          } else {
            userHtml += `<div class="msg-attach-file">📄 ${escapeHtml(att.name || '첨부 파일')}</div>`;
          }
        });
        userHtml += `</div>`;
      }
      msgEl.innerHTML = `<div class="bubble">${userHtml}</div>`;
    } else {
      msgEl.innerHTML = `<div class="bubble">${buildAssistantTurnBody(turn)}</div>`;
    }

    chatHistory.appendChild(msgEl);
    scrollToBottom();
  }

  function updateAssistantTurnElement(msgEl, turn) {
    msgEl.__turnData = turn;
    const wasOpen = msgEl.querySelector('.work-process-block')?.open;
    msgEl.innerHTML = `<div class="bubble">${buildAssistantTurnBody(turn)}</div>`;
    if (wasOpen) {
      const block = msgEl.querySelector('.work-process-block');
      if (block) block.open = true;
    }
  }

  function connectStream(cid, sessionName) {
    if (!cid && !sessionName) return;
    const url = `/api/stream?cid=${encodeURIComponent(cid)}&session=${encodeURIComponent(sessionName)}`;
    activeEventSource = new EventSource(url);

    activeEventSource.addEventListener('connected', () => {
      console.log('SSE Stream connected for', cid || sessionName);
    });

    activeEventSource.addEventListener('turn', (e) => {
      try {
        const turn = JSON.parse(e.data);
        // Remove empty state notice or terminal container if present
        const notice = chatHistory.querySelector('.empty-state');
        if (notice) notice.remove();

        const term = chatHistory.querySelector('.terminal-container');
        if (term) term.remove();

        // Remove typing indicator if present
        const typingEl = chatHistory.querySelector('.typing-msg');
        if (typingEl) typingEl.remove();

        const lastMsg = chatHistory.lastElementChild;

        // 1. Deduplicate user turn if already rendered optimistically
        if (turn.role === 'user') {
          const incomingText = (turn.content || '').trim();
          const recentUserMsgs = Array.from(chatHistory.querySelectorAll('.message.user')).slice(-3);
          let matched = false;
          for (const uMsg of recentUserMsgs) {
            const uTurn = uMsg.__turnData || {};
            const uText = (uTurn.content || uMsg.querySelector('.bubble')?.innerText || '').trim();
            if (uText === incomingText || (uText && incomingText && (uText.includes(incomingText) || incomingText.includes(uText)))) {
              uMsg.__turnData = turn;
              matched = true;
              break;
            }
          }
          if (matched) return;
        }

        // 2. Merge with last message if it is an assistant turn
        if (lastMsg && lastMsg.classList.contains('assistant') && turn.role === 'assistant') {
          const prevTurn = lastMsg.__turnData;
          if (prevTurn) {
            if (turn.thinking && typeof turn.thinking === 'string' && turn.thinking.trim()) {
              prevTurn.thinkings = prevTurn.thinkings || (prevTurn.thinking ? [prevTurn.thinking] : []);
              prevTurn.thinkings.push(turn.thinking.trim());
              prevTurn.thinking = turn.thinking.trim();
            }
            if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
              prevTurn.toolCalls = (prevTurn.toolCalls || []).concat(turn.toolCalls);
            }
            if (turn.content && typeof turn.content === 'string' && turn.content.trim()) {
              prevTurn.content = (prevTurn.content ? prevTurn.content + '\n\n' : '') + turn.content.trim();
            }
            prevTurn.timestamp = turn.timestamp || prevTurn.timestamp;
            updateAssistantTurnElement(lastMsg, prevTurn);
            scrollToBottom();
            return;
          }
        }

        appendTurn(turn);
      } catch (err) {
        console.error('Failed to parse turn event:', err);
      }
    });

    activeEventSource.addEventListener('terminal', (e) => {
      try {
        const data = JSON.parse(e.data);
        const termScreen = document.getElementById('terminalScreen');
        if (termScreen && data.text) {
          termScreen.innerText = data.text;
          scrollToBottom(true);
        } else if (!termScreen && data.text) {
          renderTerminalScreen(data.text, sessionName);
          scrollToBottom(true);
        }
      } catch (err) {
        console.error('Failed to parse terminal event:', err);
      }
    });

    activeEventSource.addEventListener('ping', () => {
      // Keepalive received
    });

    activeEventSource.onerror = (err) => {
      console.warn('SSE disconnected, retrying...', err);
    };
  }

  // --- File Attachments ---

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderAttachmentPreviews() {
    if (!attachmentPreviewBar) return;
    if (pendingAttachments.length === 0) {
      attachmentPreviewBar.style.display = 'none';
      attachmentPreviewBar.innerHTML = '';
      return;
    }

    attachmentPreviewBar.style.display = 'flex';
    attachmentPreviewBar.innerHTML = '';

    pendingAttachments.forEach((att, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const isImg = (att.type && att.type.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name || '');
      let thumbHtml = '';
      if (isImg && att.dataUrl) {
        thumbHtml = `<img src="${att.dataUrl}" class="attachment-thumb" alt="미리보기">`;
      } else {
        thumbHtml = `<span>📄</span>`;
      }

      chip.innerHTML = `
        ${thumbHtml}
        <span class="attachment-name">${escapeHtml(att.name)}</span>
        <button type="button" class="attachment-remove" aria-label="제거">✕</button>
      `;

      chip.querySelector('.attachment-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        pendingAttachments.splice(idx, 1);
        renderAttachmentPreviews();
        updateSendButtonState();
      });

      attachmentPreviewBar.appendChild(chip);
    });
  }

  function updateSendButtonState() {
    const hasText = !!composerInput.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    btnSend.disabled = (!hasText && !hasAttachments) || !currentSession;
  }

  if (btnAttach && filePicker) {
    btnAttach.addEventListener('click', () => {
      filePicker.value = '';
      filePicker.click();
    });

    filePicker.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) {
          alert(`파일 크기가 너무 큽니다 (25MB 제한): ${f.name}`);
          continue;
        }
        try {
          const dataUrl = await readFileAsDataURL(f);
          pendingAttachments.push({
            name: f.name,
            size: f.size,
            type: f.type,
            dataUrl
          });
        } catch (err) {
          console.error('Failed to read file:', f.name, err);
        }
      }
      renderAttachmentPreviews();
      updateSendButtonState();
    });
  }

  // --- Send Message ---

  let isSending = false;

  async function sendMessage() {
    if (isSending) return;
    const text = composerInput.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || !currentSession) return;

    isSending = true;
    btnSend.disabled = true;
    composerInput.disabled = true;
    if (btnAttach) btnAttach.disabled = true;

    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');
    const isTerminalActive = !!document.getElementById('terminalScreen');

    const attachmentsToUpload = [...pendingAttachments];
    pendingAttachments = [];
    renderAttachmentPreviews();

    // Optimistic user turn if in chat turn mode
    if (!isTerminalActive) {
      appendTurn({
        role: 'user',
        content: text,
        attachments: attachmentsToUpload.map(a => ({
          name: a.name,
          type: a.type,
          url: a.dataUrl
        })),
        timestamp: new Date().toISOString()
      });

      // Show typing indicator
      const typingEl = document.createElement('div');
      typingEl.className = 'message assistant typing-msg';
      typingEl.innerHTML = `<div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
      chatHistory.appendChild(typingEl);
      scrollToBottom();
    }

    composerInput.value = '';
    composerInput.style.height = 'auto';

    try {
      let uploadedFiles = [];
      if (attachmentsToUpload.length > 0) {
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: attachmentsToUpload.map(a => ({
              name: a.name,
              type: a.type,
              data: a.dataUrl
            })),
            session: sessionName,
            cid: cid
          })
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json();
          throw new Error(errData.error || '파일 업로드 실패');
        }

        const uploadData = await uploadRes.json();
        uploadedFiles = uploadData.files || [];
      }

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionName,
          cid: cid,
          text: text,
          attachments: uploadedFiles
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      alert(`전송 실패: ${err.message}`);
    } finally {
      isSending = false;
      composerInput.disabled = false;
      if (btnAttach) btnAttach.disabled = false;
      updateSendButtonState();
      composerInput.focus();
      scrollToBottom(true);
    }
  }

  // --- Event Listeners ---

  document.getElementById('btn-drawer-toggle').addEventListener('click', openDrawer);
  document.getElementById('btn-open-drawer-action').addEventListener('click', openDrawer);
  document.getElementById('btn-drawer-close').addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);

  document.getElementById('btn-refresh').addEventListener('click', () => {
    fetchSessions();
    if (currentSession) {
      selectSession(currentSession);
    }
  });

  sessionSearchInput.addEventListener('input', (e) => {
    renderSessionList(e.target.value);
  });

  composerInput.addEventListener('input', () => {
    // Autogrow
    composerInput.style.height = 'auto';
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 120)}px`;
    updateSendButtonState();
  });

  composerInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend.addEventListener('click', sendMessage);

  chatContainer.addEventListener('scroll', () => {
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50;
    isAutoScroll = isAtBottom;
    if (isAtBottom) {
      btnScrollBottom.classList.remove('visible');
    } else {
      btnScrollBottom.classList.add('visible');
    }
  });

  btnScrollBottom.addEventListener('click', () => {
    scrollToBottom(true);
  });

  // Auto-reconnect SSE on tab visibility recovery
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentSession) {
      if (!activeEventSource || activeEventSource.readyState === EventSource.CLOSED) {
        const cid = currentSession.cid || '';
        const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');
        connectStream(cid, sessionName);
      }
    }
  });

  // --- Initial Load ---
  fetchSessions().then(() => {
    const saved = localStorage.getItem('active_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        selectSession(parsed);
      } catch (e) {}
    }
  });

})();
