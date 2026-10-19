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

  let allSessions = { agy: [], claude: [], codex: [], other: [] };
  let currentSession = null;
  let activeEventSource = null;
  let isAutoScroll = true;

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
        data.turns.forEach(turn => appendTurn(turn));
      } else {
        chatHistory.innerHTML = '<div class="empty-state"><p>대화 기록이 없습니다. 메시지를 보내 세션을 시작하세요.</p></div>';
      }
      scrollToBottom(true);
    } catch (err) {
      console.error('Failed to load transcript:', err);
      chatHistory.innerHTML = `<div class="empty-state"><p>대화 내역 로드 실패: ${escapeHtml(err.message)}</p></div>`;
    }

    // Connect SSE stream
    connectStream(cid, sessionName);
  }

  function appendTurn(turn) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${turn.role || 'assistant'}`;

    let bodyHtml = '';

    // Thinking Block (if any)
    if (turn.thinking) {
      bodyHtml += `
        <details class="thinking-block">
          <summary>💭 사고 과정 확인</summary>
          <div class="tool-output">${escapeHtml(turn.thinking)}</div>
        </details>
      `;
    }

    // Tool Calls (if any)
    if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
      turn.toolCalls.forEach(tc => {
        const title = tc.summary || tc.name || '도구 실행';
        bodyHtml += `
          <details class="tool-call">
            <summary>🛠️ ${escapeHtml(title)}</summary>
            ${tc.output ? `<div class="tool-output">${escapeHtml(tc.output)}</div>` : ''}
          </details>
        `;
      });
    }

    // Main text content
    const content = turn.content || turn.text || '';
    bodyHtml += renderMarkdown(content);

    msgEl.innerHTML = `<div class="bubble">${bodyHtml}</div>`;
    chatHistory.appendChild(msgEl);
    scrollToBottom();
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
        // Remove empty state notice if present
        const notice = chatHistory.querySelector('.empty-state');
        if (notice) notice.remove();

        appendTurn(turn);
      } catch (err) {
        console.error('Failed to parse turn event:', err);
      }
    });

    activeEventSource.addEventListener('ping', () => {
      // Keepalive received
    });

    activeEventSource.onerror = (err) => {
      console.warn('SSE disconnected, retrying...', err);
    };
  }

  // --- Send Message ---

  async function sendMessage() {
    const text = composerInput.value.trim();
    if (!text || !currentSession) return;

    btnSend.disabled = true;
    composerInput.disabled = true;

    // Optimistic user turn
    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');

    appendTurn({
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    });

    composerInput.value = '';
    composerInput.style.height = 'auto';

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionName,
          cid: cid,
          text: text
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      alert(`전송 실패: ${err.message}`);
    } finally {
      composerInput.disabled = false;
      btnSend.disabled = false;
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
    btnSend.disabled = !composerInput.value.trim() || !currentSession;
  });

  composerInput.addEventListener('keydown', (e) => {
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

  // Mobile virtual keyboard handling via visualViewport
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const offset = window.innerHeight - window.visualViewport.height;
      const composerEl = document.getElementById('composer');
      if (composerEl) {
        composerEl.style.transform = offset > 0 ? `translateY(-${offset}px)` : 'none';
        scrollToBottom(true);
      }
    });
  }

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
