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

  // In-chat Search Elements
  const chatSearchBar = document.getElementById('chat-search-bar');
  const chatSearchInput = document.getElementById('chat-search-input');
  const chatSearchCount = document.getElementById('chat-search-count');
  const chatSearchNav = document.getElementById('chat-search-nav');
  const btnSearchPrev = document.getElementById('btn-search-prev');
  const btnSearchNext = document.getElementById('btn-search-next');
  const btnSearchClose = document.getElementById('btn-search-close');

  // Model Picker Elements
  const btnModelPicker = document.getElementById('btn-model-picker');
  const modelPickerName = document.getElementById('model-picker-name');
  const modelPickerSheet = document.getElementById('model-picker-sheet');
  const modelPickerBackdrop = document.getElementById('model-picker-backdrop');
  const modelSheetList = document.getElementById('model-sheet-list');
  const btnViewUsage = document.getElementById('btn-view-usage');
  const modelEffortGroup = document.getElementById('model-effort-group');

  // Usage & Quotas Elements
  const usageModalSheet = document.getElementById('usage-modal-sheet');
  const usageModalBackdrop = document.getElementById('usage-modal-backdrop');
  const usageSheetContent = document.getElementById('usage-sheet-content');
  const btnCloseUsage = document.getElementById('btn-close-usage');

  // Voice Recording Elements
  const btnVoice = document.getElementById('btn-voice');
  const voiceRecordingBar = document.getElementById('voice-recording-bar');
  const voiceRecTimer = document.getElementById('voice-rec-timer');
  const btnVoiceStop = document.getElementById('btn-voice-stop');
  const btnVoiceCancel = document.getElementById('btn-voice-cancel');

  let allSessions = { agy: [], claude: [], codex: [], other: [] };
  let currentSession = null;
  let activeEventSource = null;
  let isAutoScroll = true;
  let pendingAttachments = [];

  let searchHideTimer = null;
  let matchedMarks = [];
  let currentMatchIndex = -1;

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
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="markdown-link" href="$2" target="_blank" rel="noopener">$1</a>');

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
    fetchSessions(); // Refresh session states in background
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

        const isRunning = !!item.isRunning;
        const isRecent = !!item.isRecent;
        const timeAgo = item.timeAgo || '';

        let statusHtml = '';
        if (isRunning) {
          statusHtml = `<span class="session-status-spinner" title="동작 중 (생각/실행)"></span>`;
        } else if (isRecent) {
          statusHtml = `<span class="session-status-dot" title="동작 완료 / 최근 대화"></span>${timeAgo ? `<span class="session-status-time">${escapeHtml(timeAgo)}</span>` : ''}`;
        } else if (timeAgo) {
          statusHtml = `<span class="session-status-time">${escapeHtml(timeAgo)}</span>`;
        }

        html += `
          <div class="session-item ${activeClass}" data-session="${escapeHtml(JSON.stringify(item))}">
            <div class="session-item-info">
              <div class="session-item-name">${escapeHtml(displayName)}</div>
              ${subName ? `<div class="session-item-title">${escapeHtml(subName)}</div>` : ''}
            </div>
            <div class="session-item-right">
              ${statusHtml ? `<div class="session-status-indicator">${statusHtml}</div>` : ''}
              ${cat.key === 'agy' && item.cid ? `<button class="session-delete-btn" type="button" aria-label="대화 삭제" title="대화 삭제">🗑</button>` : ''}
            </div>
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
    sessionListEl.querySelectorAll('.session-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(JSON.parse(btn.closest('.session-item').getAttribute('data-session')));
      });
    });
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

  // Permanent: removes the conversation from the daemon and antigravity.google.com too.
  async function deleteSession(session) {
    const label = `${session.title || session.name} [${session.cid.slice(0, 8)}]`;
    if (!confirm(`"${label}" 대화를 영구 삭제합니다.\n대시보드에서도 사라지며 되돌릴 수 없습니다. 계속할까요?`)) return;
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: session.cid })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (currentSession && currentSession.cid === session.cid) {
        currentSession = null;
        localStorage.removeItem('active_session');
        chatHistory.innerHTML = '<div class="empty-state"><p>삭제된 대화입니다. 목록에서 다른 세션을 선택하세요.</p></div>';
      }
      await fetchSessions();
    } catch (err) {
      alert(`삭제 실패: ${err.message}`);
    }
  }

  // --- Select & Load Session ---

  let earliestLoadedTurnIndex = null;
  let hasEarlierMessages = false;
  let isLoadingEarlier = false;

  function renderLoadEarlierButton(remainingCount = 0) {
    let container = document.getElementById('loadEarlierContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'load-earlier-container';
      container.id = 'loadEarlierContainer';
      if (chatHistory.firstChild) {
        chatHistory.insertBefore(container, chatHistory.firstChild);
      } else {
        chatHistory.appendChild(container);
      }
    }
    const countText = remainingCount > 0 ? ` (${remainingCount}개 남음)` : '';
    container.innerHTML = `<button type="button" class="load-earlier-btn" id="btnLoadEarlier">⬆️ 이전 대화 불러오기${countText}</button>`;
    const btn = document.getElementById('btnLoadEarlier');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        loadEarlierMessages();
      });
    }
  }

  async function loadEarlierMessages() {
    if (isLoadingEarlier || !hasEarlierMessages || earliestLoadedTurnIndex === null || !currentSession) return;
    isLoadingEarlier = true;
    const btn = document.getElementById('btnLoadEarlier');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="thinking-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>이전 대화 불러오는 중...`;
    }

    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');

    try {
      const res = await fetch(`/api/transcript?cid=${encodeURIComponent(cid)}&session=${encodeURIComponent(sessionName)}&limit=60&before=${earliestLoadedTurnIndex}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.turns && data.turns.length > 0) {
        // 1. Find the first visible message element in viewport as anchoring reference
        const containerRect = chatContainer.getBoundingClientRect();
        const existingMessages = chatHistory.querySelectorAll('.message');
        let anchorEl = null;
        let anchorOffset = 0;

        for (let i = 0; i < existingMessages.length; i++) {
          const rect = existingMessages[i].getBoundingClientRect();
          if (rect.bottom > containerRect.top) {
            anchorEl = existingMessages[i];
            anchorOffset = rect.top - containerRect.top;
            break;
          }
        }

        const prevScrollHeight = chatContainer.scrollHeight;
        const prevScrollTop = chatContainer.scrollTop;

        // 2. Build and prepend turns cleanly
        const grouped = groupTurnsForDisplay(data.turns);
        const fragment = document.createDocumentFragment();
        grouped.forEach(t => {
          fragment.appendChild(createTurnElement(t));
        });

        const container = document.getElementById('loadEarlierContainer');
        if (container && container.nextSibling) {
          chatHistory.insertBefore(fragment, container.nextSibling);
        } else if (chatHistory.firstChild) {
          chatHistory.insertBefore(fragment, chatHistory.firstChild);
        } else {
          chatHistory.appendChild(fragment);
        }

        earliestLoadedTurnIndex = data.earliestIndex || (data.turns[0] ? data.turns[0].index : earliestLoadedTurnIndex);
        hasEarlierMessages = !!data.hasEarlier;

        // 3. Pixel-perfect scroll restoration using the anchor element
        if (anchorEl) {
          const newRect = anchorEl.getBoundingClientRect();
          const delta = (newRect.top - containerRect.top) - anchorOffset;
          chatContainer.scrollTop += delta;
        } else {
          const newScrollHeight = chatContainer.scrollHeight;
          chatContainer.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      } else {
        hasEarlierMessages = false;
      }

      const container = document.getElementById('loadEarlierContainer');
      if (!hasEarlierMessages) {
        if (container) {
          container.outerHTML = '<div class="transcript-beginning-marker">🌱 대화의 시작입니다</div>';
        }
      } else if (btn) {
        btn.disabled = false;
        const remaining = Math.max(0, (data.totalCount || 0) - chatHistory.querySelectorAll('.message').length);
        const countText = remaining > 0 ? ` (${remaining}개 남음)` : '';
        btn.innerHTML = `⬆️ 이전 대화 불러오기${countText}`;
      }
    } catch (err) {
      console.error('Failed to load earlier messages:', err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `⚠️ 재시도: 이전 대화 불러오기`;
      }
    } finally {
      isLoadingEarlier = false;
    }
  }

  async function selectSession(session) {
    if (!session) return;
    currentSession = session;
    localStorage.setItem('active_session', JSON.stringify(session));

    // Reset pagination state
    earliestLoadedTurnIndex = null;
    hasEarlierMessages = false;
    isLoadingEarlier = false;

    // Update Header
    headerTitle.innerText = session.title || session.name;
    headerSubtitle.innerText = session.name || (session.cid ? `cid: ${session.cid.slice(0, 8)}` : '');
    headerBadge.innerText = (session.type || 'active').toUpperCase();
    headerBadge.className = `badge ${session.type || ''}`;

    // Update Google Web Remote Link with current session conversation URL
    const btnGoogleWeb = document.getElementById('btn-google-web');
    if (btnGoogleWeb) {
      const targetCid = session.cid || (session.name && session.name.startsWith('rc_') ? session.name.slice(3) : null);
      if (targetCid) {
        // 즉시 현재 세션 대화 주소 바인딩 (인증 지원 공식 클라우드 웹 콘솔)
        const initialUrl = `https://antigravity.google.com/c/${targetCid}`;
        btnGoogleWeb.href = initialUrl;
        btnGoogleWeb.title = `Google Web 대시보드 열기 (${targetCid})`;
        btnGoogleWeb.style.display = 'inline-flex';

        fetch(`/api/remote-url?cid=${encodeURIComponent(targetCid)}`)
          .then(r => r.json())
          .then(d => {
            if (d && d.url) {
              btnGoogleWeb.href = d.url;
              if (d.cid) btnGoogleWeb.title = `Google Web 대시보드 열기 (${d.cid})`;
            }
          })
          .catch(() => {});
      } else {
        btnGoogleWeb.style.display = 'none';
      }
    }

    // Show Chat, Hide Empty State
    emptyState.style.display = 'none';
    chatHistory.innerHTML = '<div class="loading-spinner">대화 내역을 불러오는 중...</div>';
    renderQueuedMessages();

    // Reset in-chat search
    if (chatSearchInput) chatSearchInput.value = '';
    clearSearchHighlights();
    hideChatSearchBar();

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
      hasEarlierMessages = !!data.hasEarlier;
      earliestLoadedTurnIndex = data.earliestIndex || (data.turns && data.turns[0] ? data.turns[0].index : null);

      if (data.turns && data.turns.length > 0) {
        if (hasEarlierMessages) {
          const remaining = Math.max(0, (data.totalCount || 0) - data.turns.length);
          renderLoadEarlierButton(remaining);
        }
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
    renderQueuedMessages();
    checkAndProcessQueue();
    updateUserProcessingState();
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

  function buildAssistantTurnBody(turn, forceOpen = false) {
    let bodyHtml = '';

    const hasThinkings = (turn.thinkings && turn.thinkings.length > 0) || (turn.thinking && turn.thinking.trim());
    const toolList = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    const toolCount = toolList.length;
    const hasWorkProcess = hasThinkings || toolCount > 0;
    const content = (turn.content || turn.text || '').trim();
    const isGenerating = !content;

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
      const shouldOpen = forceOpen || isGenerating;

      let innerHtml = '';
      if (hasThinkings) {
        const fullThinking = turn.thinkings && turn.thinkings.length > 0
          ? turn.thinkings.join('\n\n---\n\n')
          : turn.thinking;
        innerHtml += `
          <div class="process-section">
            <div class="process-subtitle">💭 사고 과정 ${isGenerating ? '<span class="live-badge"><span class="live-indicator-dot"></span>생각 중</span>' : ''}</div>
            <div class="process-text ${isGenerating ? 'thinking-preview-text' : ''}">${escapeHtml(fullThinking)}</div>
          </div>
        `;
      }

      if (toolCount > 0) {
        const renderToolItem = (tc, idx) => {
          const title = tc.label || tc.summary || tc.name || `도구 #${idx + 1}`;
          let cmdStr = '';
          if (tc.args && typeof tc.args === 'object') {
            if (tc.args.CommandLine) cmdStr = tc.args.CommandLine;
            else if (tc.args.AbsolutePath) cmdStr = tc.args.AbsolutePath;
            else if (tc.args.query) cmdStr = tc.args.query;
            else if (Object.keys(tc.args).length > 0) cmdStr = JSON.stringify(tc.args);
          }
          return `
            <div class="process-tool-item">
              <div class="tool-item-header">
                <span class="tool-badge">${escapeHtml(tc.name || 'tool')}</span>
                <span class="tool-title">${escapeHtml(title)}</span>
              </div>
              ${cmdStr ? `<pre class="tool-cmd">${escapeHtml(cmdStr)}</pre>` : ''}
              ${tc.output ? `<pre class="tool-output">${escapeHtml(tc.output)}</pre>` : ''}
            </div>
          `;
        };

        let toolsListHtml = '';
        if (toolCount <= 2) {
          toolsListHtml = toolList.map(renderToolItem).join('');
        } else {
          const earlierTools = toolList.slice(0, -2);
          const recentTools = toolList.slice(-2);
          const earlierHtml = earlierTools.map((tc, idx) => renderToolItem(tc, idx)).join('');
          const recentHtml = recentTools.map((tc, idx) => renderToolItem(tc, earlierTools.length + idx)).join('');
          toolsListHtml = `
            <button type="button" class="btn-toggle-tools" data-count="${earlierTools.length}">
              ▼ 이전 도구 실행 내역 ${earlierTools.length}건 더보기
            </button>
            <div class="earlier-tools-wrap" style="display: none;">
              ${earlierHtml}
            </div>
            ${recentHtml}
          `;
        }

        innerHtml += `
          <div class="process-section">
            <div class="process-subtitle">🛠️ 도구 실행 내역 (${toolCount}건) ${isGenerating ? '<span class="live-badge"><span class="live-indicator-dot"></span>실행 중</span>' : ''}</div>
            <div class="process-tools-list">
              ${toolsListHtml}
            </div>
          </div>
        `;
      }

      bodyHtml += `
        <details class="work-process-block" ${shouldOpen ? 'open' : ''}>
          <summary class="work-process-summary">
            <span class="work-process-label">${escapeHtml(summaryLabel)}</span>
            ${isGenerating ? '<span class="live-badge"><span class="live-indicator-dot"></span>진행 중</span>' : ''}
          </summary>
          <div class="work-process-body">
            ${innerHtml}
          </div>
        </details>
      `;
    } else if (isGenerating) {
      bodyHtml += `
        <div class="live-thinking-card">
          <div class="thinking-header">
            <div class="thinking-spinner"></div>
            <span class="thinking-title">에이전트가 생각하고 있습니다...</span>
            <span class="live-badge"><span class="live-indicator-dot"></span>사고 중</span>
          </div>
          <div class="thinking-preview">답변 및 도구 실행을 계획하는 중입니다...</div>
        </div>
      `;
    }

    if (content) {
      bodyHtml += `<div class="turn-markdown">${renderMarkdown(content)}</div>`;
    } else if (!hasWorkProcess && !isGenerating) {
      bodyHtml += `<div class="turn-markdown empty-content">(내용 없음)</div>`;
    }

    // Assistant Turn Footer: Review & Copy Buttons
    if (!isGenerating && (content || hasWorkProcess)) {
      bodyHtml += `
        <div class="turn-footer">
          <div class="turn-footer-left">
            <button class="turn-review-btn" type="button" title="코드 변경 사항 리뷰">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <span>Review</span>
            </button>
          </div>
          <div class="turn-footer-right">
            ${turn.timestamp ? `<span class="turn-time">${formatTimeAgo(turn.timestamp)}</span>` : ''}
            <button class="turn-copy-btn" type="button" title="답변 복사" aria-label="답변 복사">
              <svg class="icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <svg class="icon-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    return bodyHtml;
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);
      if (isNaN(diffSec) || diffSec < 0) return '';
      if (diffSec < 60) return '방금 전';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      const diffDays = Math.floor(diffHour / 24);
      return `${diffDays}d ago`;
    } catch (e) {
      return '';
    }
  }

  function formatMessageTime(timestamp) {
    if (!timestamp) {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return '';
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return `${hours}:${minutes}`;
      }
      const month = d.getMonth() + 1;
      const date = d.getDate();
      return `${month}/${date} ${hours}:${minutes}`;
    } catch (e) {
      return '';
    }
  }

  const attachmentContentCache = new Map();

  function loadAttachmentText(url, codeElement) {
    if (!url || !codeElement) return;
    if (attachmentContentCache.has(url)) {
      codeElement.textContent = attachmentContentCache.get(url);
      return;
    }
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(txt => {
        attachmentContentCache.set(url, txt);
        codeElement.textContent = txt;
      })
      .catch(err => {
        codeElement.textContent = `(파일 내용 로드 실패: ${err.message})`;
      });
  }

  function extractUserTurnAttachments(rawContent, initialAttachments = []) {
    let cleanText = String(rawContent || '');
    const list = [...(initialAttachments || [])];

    const attachBlockRegex = /(?:\n\s*)?\[(?:첨부 파일|Attached Files)\]\s*([\s\S]*)$/i;
    const match = cleanText.match(attachBlockRegex);

    if (match) {
      const listPart = match[1];
      cleanText = cleanText.slice(0, match.index).trim();
      const lines = listPart.split('\n');
      for (const line of lines) {
        const trimmed = line.replace(/^[\s\-\*•]+/, '').trim();
        if (!trimmed) continue;
        const fileName = trimmed.split('/').pop() || 'attachment';
        const already = list.some(a => (a.name === fileName) || (a.path === trimmed) || (a.url && a.url.includes(fileName)));
        if (!already) {
          const isUpload = trimmed.includes('/uploads/');
          const url = isUpload ? `/uploads/${fileName}` : trimmed;
          list.push({
            name: fileName,
            path: trimmed,
            url: url
          });
        }
      }
    }

    return { cleanText, attachments: list };
  }

  function createTurnElement(turn) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${turn.role || 'assistant'}`;
    msgEl.__turnData = turn;

    if (turn.role === 'user') {
      const { cleanText, attachments } = extractUserTurnAttachments(turn.content, turn.attachments);
      let userHtml = '';
      if (cleanText) {
        userHtml += `<div class="user-content-text">${escapeHtml(cleanText)}</div>`;
      }

      const textLoadQueue = [];

      if (attachments && attachments.length > 0) {
        userHtml += `<div class="message-attachments">`;
        attachments.forEach((att, idx) => {
          const fileName = att.name || (att.path ? att.path.split('/').pop() : '') || 'attachment';
          const fileUrl = att.url || (att.path && att.path.includes('/uploads/') ? `/uploads/${fileName}` : att.path) || '';
          const displayPath = att.path || att.url || fileName;
          const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
          const ext = extMatch ? extMatch[1].toLowerCase() : '';

          const isImg = (att.type && att.type.startsWith('image/')) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
          const isText = (att.type && (att.type.startsWith('text/') || att.type.includes('json') || att.type.includes('javascript') || att.type.includes('xml'))) ||
            ['txt', 'md', 'json', 'js', 'mjs', 'ts', 'py', 'sh', 'bash', 'css', 'html', 'log', 'csv', 'yaml', 'yml', 'xml', 'sql', 'diff'].includes(ext);

          userHtml += `<div class="msg-attach-card">`;
          userHtml += `
            <div class="msg-attach-card-header">
              <span class="msg-attach-header-title">
                <span>${isImg ? '🖼️' : (isText ? '📄' : '📦')}</span>
                <span>${escapeHtml(fileName)}</span>
              </span>
              ${ext ? `<span class="msg-attach-ext-badge">${escapeHtml(ext)}</span>` : ''}
            </div>
          `;

          // 1. 컨텐츠 렌더링
          if (isImg && fileUrl) {
            userHtml += `<img src="${escapeHtml(fileUrl)}" class="msg-attach-img" alt="${escapeHtml(fileName)}" loading="lazy">`;
          } else if (isText && fileUrl) {
            const codeId = `attach-code-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
            let directContent = att.content || null;
            if (!directContent && att.dataUrl && att.dataUrl.includes(';base64,')) {
              try {
                directContent = atob(att.dataUrl.split(';base64,')[1]);
              } catch (e) {}
            }

            if (directContent) {
              userHtml += `<pre class="msg-attach-code"><code>${escapeHtml(directContent)}</code></pre>`;
            } else {
              userHtml += `<pre class="msg-attach-code"><code id="${codeId}">텍스트 내용 불러오는 중...</code></pre>`;
              textLoadQueue.push({ url: fileUrl, elementId: codeId });
            }
          } else {
            userHtml += `<div class="msg-attach-file"><span>📦 ${escapeHtml(fileName)}</span></div>`;
          }

          // 2. 링크 주소 디폴트 접힘 아코디언 (클릭 시 펼침)
          userHtml += `
            <details class="attach-link-disclosure">
              <summary class="attach-link-summary">
                <svg class="attach-link-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                <span>첨부 파일 링크 / 경로 보기</span>
                <span class="attach-caret">▾</span>
              </summary>
              <div class="attach-link-body">
                <a href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer" class="attach-link-anchor" title="새 창에서 원본 열기">${escapeHtml(displayPath)}</a>
              </div>
            </details>
          `;

          userHtml += `</div>`; // .msg-attach-card
        });
        userHtml += `</div>`; // .message-attachments
      }

      const timeText = formatMessageTime(turn.timestamp);
      const isProcessing = !!turn.isProcessing;
      const metaHtml = `
        <div class="user-turn-meta">
          ${isProcessing ? '<span class="user-processing-indicator" title="에이전트가 처리 중입니다..."><span class="user-spinner-dot"></span></span>' : ''}
          ${timeText ? `<span class="turn-time user-turn-time">${escapeHtml(timeText)}</span>` : ''}
          <button class="turn-copy-btn user-copy-btn" type="button" title="메시지 복사" aria-label="메시지 복사">
            <svg class="icon-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <svg class="icon-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        </div>
      `;

      msgEl.innerHTML = `
        <div class="user-message-row">
          ${metaHtml}
          <div class="bubble">${userHtml}</div>
        </div>
      `;

      if (textLoadQueue.length > 0) {
        setTimeout(() => {
          textLoadQueue.forEach(item => {
            const el = document.getElementById(item.elementId);
            if (el) loadAttachmentText(item.url, el);
          });
        }, 10);
      }
    } else {
      msgEl.innerHTML = `<div class="bubble">${buildAssistantTurnBody(turn)}</div>`;
    }

    return msgEl;
  }

  function appendTurn(turn) {
    const msgEl = createTurnElement(turn);
    chatHistory.appendChild(msgEl);
    scrollToBottom();
    updateUserProcessingState();
  }

  function updateUserProcessingState() {
    if (!chatHistory) return;
    const userMsgs = chatHistory.querySelectorAll('.message.user');
    if (userMsgs.length === 0) return;

    // 모든 사용자 메시지에서 기존 스피너 제거
    chatHistory.querySelectorAll('.user-processing-indicator').forEach(el => el.remove());

    // 현재 세션이 busy(생각 중, 도구 실행 중, 또는 typing-msg 존재) 상태라면
    // 가장 최근 사용자 메시지 메타 영역(가장 앞)에 움직이는 스피너 추가
    if (isSessionBusy()) {
      const lastUserMsg = userMsgs[userMsgs.length - 1];
      const meta = lastUserMsg.querySelector('.user-turn-meta');
      if (meta && !meta.querySelector('.user-processing-indicator')) {
        const spinner = document.createElement('span');
        spinner.className = 'user-processing-indicator';
        spinner.title = '에이전트가 처리 중입니다...';
        spinner.innerHTML = '<span class="user-spinner-dot"></span>';
        meta.insertBefore(spinner, meta.firstChild);
      }
    }
  }

  function updateAssistantTurnElement(msgEl, turn) {
    msgEl.__turnData = turn;
    const wasOpen = msgEl.querySelector('.work-process-block')?.open;
    const isGenerating = !turn.content || !turn.content.trim();
    const shouldOpen = (wasOpen !== false) || isGenerating;
    msgEl.innerHTML = `<div class="bubble">${buildAssistantTurnBody(turn, shouldOpen)}</div>`;
    if (shouldOpen) {
      const block = msgEl.querySelector('.work-process-block');
      if (block) block.open = true;
    }
    updateUserProcessingState();
  }

  let isSyncingSession = false;
  let lastSyncTime = 0;

  async function syncActiveSession(forceReconnect = true) {
    if (!currentSession || isSyncingSession) return;
    const now = Date.now();
    // 1초 이내 빈번한 중복 sync 호출 방지 (알림창 열고 닫을 때 focus/visibilitychange 연쇄 호출 방어)
    if (now - lastSyncTime < 1000 && !forceReconnect) return;
    lastSyncTime = now;

    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');
    if (!cid && !sessionName) return;

    isSyncingSession = true;
    try {
      const res = await fetch(`/api/transcript?cid=${encodeURIComponent(cid)}&session=${encodeURIComponent(sessionName)}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.turns)) {
          const typingEl = chatHistory.querySelector('.typing-msg');

          if (data.turns.length > 0) {
            const existingMessages = chatHistory.querySelectorAll('.message:not(.typing-msg)');
            const grouped = groupTurnsForDisplay(data.turns);

            if (existingMessages.length === 0) {
              chatHistory.innerHTML = '';
              grouped.forEach(t => appendTurn(t));
              if (isAutoScroll) {
                scrollToBottom(true);
              }
            } else {
              const latestServerTurn = grouped[grouped.length - 1];
              const lastRenderedEl = chatHistory.querySelector('.message:last-of-type:not(.typing-msg)');
              const lastRenderedTurn = lastRenderedEl ? lastRenderedEl.__turnData : null;

              const isDifferentLastTurn = !lastRenderedTurn ||
                latestServerTurn.index !== lastRenderedTurn.index ||
                latestServerTurn.role !== lastRenderedTurn.role ||
                (latestServerTurn.content || '') !== (lastRenderedTurn.content || '') ||
                ((latestServerTurn.toolCalls || []).length !== (lastRenderedTurn.toolCalls || []).length);

              // 사용자가 이전 메시지를 로드한 상태(existingMessages.length > grouped.length)에서는
              // 단순 100개 길이 비교로 전체 DOM을 날리지 않음!
              const hasLoadedEarlier = earliestLoadedTurnIndex !== null && existingMessages.length >= grouped.length;
              const needsFullRerender = isDifferentLastTurn || (!hasLoadedEarlier && grouped.length !== existingMessages.length);

              if (needsFullRerender) {
                // 현재 스크롤 위치 및 바닥 여부 정밀 보존
                const prevScrollTop = chatContainer.scrollTop;
                const wasNearBottom = isAutoScroll && ((chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < 180);

                chatHistory.innerHTML = '';
                hasEarlierMessages = !!data.hasEarlier;
                earliestLoadedTurnIndex = data.earliestIndex || (data.turns && data.turns[0] ? data.turns[0].index : null);

                if (hasEarlierMessages) {
                  const remaining = Math.max(0, (data.totalCount || 0) - data.turns.length);
                  renderLoadEarlierButton(remaining);
                }
                grouped.forEach(t => appendTurn(t));

                if (wasNearBottom) {
                  scrollToBottom(true);
                } else {
                  // 사용자가 중간 대화를 읽거나 캡처하려고 터치 중이었다면 원래 스크롤 위치 완벽 복원
                  chatContainer.scrollTop = prevScrollTop;
                }
              }
            }

            // Ensure typing indicator is removed if assistant turn is present
            const hasAssistantTurn = data.turns.some(t => t.role === 'assistant');
            if (hasAssistantTurn && typingEl) {
              typingEl.remove();
            }
          }
        }
      }
    } catch (err) {
      console.warn('Sync active session error:', err);
    } finally {
      isSyncingSession = false;
      checkAndProcessQueue();
      updateUserProcessingState();
    }

    // Reconnect SSE if requested or if dead
    if (forceReconnect || !activeEventSource || activeEventSource.readyState === EventSource.CLOSED) {
      if (activeEventSource) {
        try { activeEventSource.close(); } catch (e) {}
        activeEventSource = null;
      }
      connectStream(cid, sessionName);
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
            if (prevTurn.content) {
              checkAndProcessQueue();
            }
            return;
          }
        }

        appendTurn(turn);
        if (turn.role === 'assistant' && turn.content) {
          checkAndProcessQueue();
        }
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

    activeEventSource.addEventListener('relay-url', (e) => {
      try {
        const data = JSON.parse(e.data);
        const btnGoogleWeb = document.getElementById('btn-google-web');
        if (btnGoogleWeb && data && data.url) {
          btnGoogleWeb.href = data.url;
          btnGoogleWeb.style.display = 'inline-flex';
        }
      } catch (err) {}
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

  // --- Message Queue (대기열) System ---

  const queuedContainer = document.getElementById('queued-messages-container');

  function getActiveQueue() {
    const cid = currentSession ? (currentSession.cid || currentSession.name || 'default') : 'default';
    try {
      const raw = localStorage.getItem('sm_queue_' + cid);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveActiveQueue(queue) {
    const cid = currentSession ? (currentSession.cid || currentSession.name || 'default') : 'default';
    try {
      if (queue && queue.length > 0) {
        localStorage.setItem('sm_queue_' + cid, JSON.stringify(queue));
      } else {
        localStorage.removeItem('sm_queue_' + cid);
      }
    } catch (e) {}
  }

  function isSessionBusy() {
    if (isSending) return true;
    if (chatHistory && chatHistory.querySelector('.typing-msg')) return true;
    if (currentSession && (currentSession.isRunning || currentSession.status === 'CASCADE_RUN_STATUS_RUNNING')) return true;
    const lastMsg = chatHistory ? chatHistory.querySelector('.message.assistant:last-child') : null;
    if (lastMsg && lastMsg.__turnData && !lastMsg.__turnData.content) return true;
    return false;
  }

  function renderQueuedMessages() {
    if (!queuedContainer) return;
    const queue = getActiveQueue();
    if (!queue || queue.length === 0) {
      queuedContainer.style.display = 'none';
      queuedContainer.innerHTML = '';
      return;
    }

    queuedContainer.style.display = 'flex';
    const total = queue.length;
    queuedContainer.innerHTML = queue.map((item, idx) => {
      const timeStr = item.timeStr || (item.createdAt ? formatMessageTime(new Date(item.createdAt).toISOString()) : '방금');
      const attachInfo = item.attachments && item.attachments.length > 0
        ? `<div class="queued-attachments">📎 첨부파일 ${item.attachments.length}개 (${escapeHtml(item.attachments.map(a => a.name).join(', '))})</div>`
        : '';
      return `
        <div class="queued-card" data-qid="${item.id}">
          <div class="queued-card-header">
            <div class="queued-badge-wrap">
              <span class="queued-badge">대기 중 ${idx + 1}/${total}</span>
              <span class="queued-time">${escapeHtml(timeStr)}</span>
            </div>
            ${total > 1 ? `
              <div class="queued-reorder-actions">
                <button type="button" class="btn-queue-order btn-queue-up" data-idx="${idx}" title="위로 이동" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button type="button" class="btn-queue-order btn-queue-down" data-idx="${idx}" title="아래로 이동" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
              </div>
            ` : ''}
          </div>
          <div class="queued-card-body">
            <div class="queued-text">${escapeHtml(item.text)}</div>
            ${attachInfo}
          </div>
          <div class="queued-card-actions">
            <button type="button" class="btn-queue-action btn-queue-send" data-idx="${idx}" title="현재 대기 없이 바로 보내기">
              ⚡ 바로 보내기
            </button>
            <button type="button" class="btn-queue-action btn-queue-edit" data-idx="${idx}" title="입력창으로 불러와 수정">
              ✏️ 수정
            </button>
            <button type="button" class="btn-queue-action btn-queue-discard" data-idx="${idx}" title="대기열에서 삭제">
              🗑️ 폐기
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (queuedContainer) {
    queuedContainer.addEventListener('click', (e) => {
      const queue = getActiveQueue();
      if (!queue || queue.length === 0) return;

      // 1. 위로 이동
      const upBtn = e.target.closest('.btn-queue-up');
      if (upBtn) {
        e.stopPropagation();
        const idx = parseInt(upBtn.getAttribute('data-idx'), 10);
        if (idx > 0 && idx < queue.length) {
          const temp = queue[idx - 1];
          queue[idx - 1] = queue[idx];
          queue[idx] = temp;
          saveActiveQueue(queue);
          renderQueuedMessages();
        }
        return;
      }

      // 2. 아래로 이동
      const downBtn = e.target.closest('.btn-queue-down');
      if (downBtn) {
        e.stopPropagation();
        const idx = parseInt(downBtn.getAttribute('data-idx'), 10);
        if (idx >= 0 && idx < queue.length - 1) {
          const temp = queue[idx + 1];
          queue[idx + 1] = queue[idx];
          queue[idx] = temp;
          saveActiveQueue(queue);
          renderQueuedMessages();
        }
        return;
      }

      // 3. 바로 보내기
      const sendBtn = e.target.closest('.btn-queue-send');
      if (sendBtn) {
        e.stopPropagation();
        const idx = parseInt(sendBtn.getAttribute('data-idx'), 10);
        if (idx >= 0 && idx < queue.length) {
          const item = queue.splice(idx, 1)[0];
          saveActiveQueue(queue);
          renderQueuedMessages();
          executeDirectSend(item.text, item.attachments || []);
        }
        return;
      }

      // 4. 수정하기
      const editBtn = e.target.closest('.btn-queue-edit');
      if (editBtn) {
        e.stopPropagation();
        const idx = parseInt(editBtn.getAttribute('data-idx'), 10);
        if (idx >= 0 && idx < queue.length) {
          const item = queue.splice(idx, 1)[0];
          saveActiveQueue(queue);
          renderQueuedMessages();
          composerInput.value = item.text || '';
          composerInput.style.height = 'auto';
          composerInput.style.height = `${Math.min(composerInput.scrollHeight, 160)}px`;
          pendingAttachments = (item.attachments || []).map(a => ({
            name: a.name,
            type: a.type,
            dataUrl: a.dataUrl || a.url
          }));
          renderAttachmentPreviews();
          updateSendButtonState();
          composerInput.focus();
        }
        return;
      }

      // 5. 폐기하기
      const discardBtn = e.target.closest('.btn-queue-discard');
      if (discardBtn) {
        e.stopPropagation();
        const idx = parseInt(discardBtn.getAttribute('data-idx'), 10);
        if (idx >= 0 && idx < queue.length) {
          queue.splice(idx, 1);
          saveActiveQueue(queue);
          renderQueuedMessages();
        }
        return;
      }
    });
  }

  function checkAndProcessQueue() {
    if (!currentSession || isSending || isSessionBusy()) return;
    const queue = getActiveQueue();
    if (queue && queue.length > 0) {
      const nextItem = queue.shift();
      saveActiveQueue(queue);
      renderQueuedMessages();
      setTimeout(() => {
        executeDirectSend(nextItem.text, nextItem.attachments || []);
      }, 300);
    }
  }

  // --- Send Message ---

  let isSending = false;

  async function sendMessage() {
    if (isSending) return;
    const text = composerInput.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || !currentSession) return;

    // 만약 에이전트가 생각 중이거나 작업 중이면 대기열(Queue)에 등록
    if (isSessionBusy()) {
      const queue = getActiveQueue();
      queue.push({
        id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: text,
        attachments: [...pendingAttachments],
        createdAt: Date.now(),
        timeStr: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      });
      saveActiveQueue(queue);
      composerInput.value = '';
      composerInput.style.height = 'auto';
      pendingAttachments = [];
      renderAttachmentPreviews();
      updateSendButtonState();
      renderQueuedMessages();
      return;
    }

    const attachmentsToUpload = [...pendingAttachments];
    pendingAttachments = [];
    renderAttachmentPreviews();
    composerInput.value = '';
    composerInput.style.height = 'auto';

    await executeDirectSend(text, attachmentsToUpload);
  }

  async function executeDirectSend(text, attachmentsToUpload = []) {
    if (isSending || !currentSession) return;
    isSending = true;
    btnSend.disabled = true;
    composerInput.disabled = true;
    if (btnAttach) btnAttach.disabled = true;

    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');
    const isTerminalActive = !!document.getElementById('terminalScreen');

    // Optimistic user turn if in chat turn mode
    if (!isTerminalActive) {
      appendTurn({
        role: 'user',
        content: text,
        isProcessing: true,
        attachments: (attachmentsToUpload || []).map(a => ({
          name: a.name,
          type: a.type,
          url: a.dataUrl || a.url
        })),
        timestamp: new Date().toISOString()
      });

      // Show live thinking indicator
      const typingEl = document.createElement('div');
      typingEl.className = 'message assistant typing-msg';
      typingEl.innerHTML = `
        <div class="bubble">
          <div class="live-thinking-card">
            <div class="thinking-header">
              <div class="thinking-spinner"></div>
              <span class="thinking-title">에이전트가 생각하고 있습니다...</span>
              <span class="live-badge"><span class="live-indicator-dot"></span>사고 중</span>
            </div>
            <div class="thinking-preview">입력된 내용을 분석하고 실행 계획을 수립하고 있습니다...</div>
          </div>
        </div>
      `;
      chatHistory.appendChild(typingEl);
      scrollToBottom();
    }

    try {
      let uploadedFiles = [];
      if (attachmentsToUpload && attachmentsToUpload.length > 0) {
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: attachmentsToUpload.map(a => ({
              name: a.name,
              type: a.type,
              data: a.dataUrl || a.url
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

      const selectedModelObj = typeof getSelectedModel === 'function' ? getSelectedModel() : null;
      const sendPayload = {
        session: sessionName,
        cid: cid,
        text: text,
        attachments: uploadedFiles
      };
      if (selectedModelObj && selectedModelObj.model) {
        sendPayload.model = selectedModelObj.model;
        const budget = typeof selectedEffort !== 'undefined'
          ? (selectedEffort === 'low' ? 1000 : (selectedEffort === 'mid' ? 4000 : -1))
          : -1;
        sendPayload.effort = typeof selectedEffort !== 'undefined' ? selectedEffort : 'high';
        sendPayload.plannerConfig = {
          planModel: selectedModelObj.model,
          requestedModel: { model: selectedModelObj.model },
          thinkingBudget: budget
        };
      }

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendPayload)
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
      checkAndProcessQueue();
      updateUserProcessingState();
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

  const btnGoogleWebEl = document.getElementById('btn-google-web');
  if (btnGoogleWebEl) {
    btnGoogleWebEl.addEventListener('click', (e) => {
      const cid = currentSession ? (currentSession.cid || (currentSession.name && currentSession.name.startsWith('rc_') ? currentSession.name.slice(3) : '')) : '';
      if (cid) {
        const fullUrl = `https://antigravity.google.com/c/${cid}`;
        btnGoogleWebEl.href = fullUrl;
        window.open(fullUrl, '_blank', 'noopener,noreferrer');
        e.preventDefault();
      }
    });
  }

  let isComposing = false;
  composerInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  composerInput.addEventListener('compositionend', () => {
    isComposing = false;
  });

  composerInput.addEventListener('input', () => {
    // Autogrow up to 160px
    composerInput.style.height = 'auto';
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 160)}px`;
    updateSendButtonState();
  });

  composerInput.addEventListener('keydown', (e) => {
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btnSend.addEventListener('click', sendMessage);

  // Soft keyboard positioning with visualViewport API
  if (window.visualViewport) {
    const onViewportResize = () => {
      const composer = document.getElementById('composer');
      if (!composer) return;

      const vv = window.visualViewport;
      // 1. 임시로 transform을 해제하여 CSS 기본 레이아웃 상의 바닥 좌표 측정
      composer.style.transform = 'none';
      const rect = composer.getBoundingClientRect();

      // 2. 가시 뷰포트의 실제 바닥 좌표 (visualViewport 높이 + 상단 오프셋)
      const viewportBottom = vv.height + (vv.offsetTop || 0);

      // 3. 브라우저가 레이아웃을 줄이지 않아 키보드에 가려진 실제 오버랩(overlap)만 계산
      // 키보드 상단 윗선에 빈 공간(여백) 없이 0px 오차로 완벽 밀착
      const overlap = Math.max(0, Math.round(rect.bottom - viewportBottom));

      // 4. 상단 헤더 아래 안전선(Clamp): 최소 top 좌표를 상단 헤더 바로 아래로 제한하여 주소창 침범 방지
      const headerEl = document.getElementById('header');
      const headerH = headerEl ? headerEl.offsetHeight : 56;
      const minAllowedTop = headerH + 8;
      const maxAllowedOffset = Math.max(0, Math.round(rect.top - minAllowedTop));
      const finalOffset = Math.min(overlap, maxAllowedOffset);

      const isKeyboardOpen = finalOffset > 0;
      if (isKeyboardOpen) {
        composer.style.transform = `translateY(-${finalOffset}px)`;
        composer.classList.add('keyboard-active');
      } else {
        composer.style.transform = 'none';
        composer.classList.remove('keyboard-active');
      }

      if (chatContainer) {
        chatContainer.style.paddingBottom = isKeyboardOpen ? `${finalOffset + 16}px` : '16px';
      }

      // 오직 입력창에 직접 포커스가 가 있고 사용자가 원래 맨 바닥을 보고 있었을 때만 맨 아래로 정렬!
      // (중간 대화를 보거나 캡처하려고 터치/툴바 제스처를 취할 때는 스크롤 위치를 절대 건드리지 않음)
      if (isKeyboardOpen && document.activeElement === composerInput && isAutoScroll) {
        scrollToBottom(false);
      }
    };
    window.visualViewport.addEventListener('resize', onViewportResize);
    // 주의: visualViewport 'scroll' 리스너는 화면 터치/스크롤 제스처 시 발화하여 오작동을 유발하므로 등록하지 않음!
  }

  // --- In-chat Search Functionality (Reveals on Scroll-Up) ---

  function showChatSearchBar() {
    if (!chatSearchBar) return;
    chatSearchBar.classList.add('visible');
    resetSearchHideTimer();
  }

  function hideChatSearchBar() {
    if (!chatSearchBar) return;
    chatSearchBar.classList.remove('visible');
    clearTimeout(searchHideTimer);
    searchHideTimer = null;
    if (chatSearchInput && document.activeElement === chatSearchInput) {
      chatSearchInput.blur();
    }
    if (chatSearchInput && !chatSearchInput.value.trim()) {
      clearSearchHighlights();
    }
  }

  function resetSearchHideTimer() {
    clearTimeout(searchHideTimer);
    searchHideTimer = null;
    if (chatSearchInput && !chatSearchInput.value.trim()) {
      searchHideTimer = setTimeout(() => {
        if (!chatSearchInput.value.trim() && document.activeElement !== chatSearchInput) {
          hideChatSearchBar();
        }
      }, 3000);
    }
  }

  function clearSearchHighlights() {
    matchedMarks = [];
    currentMatchIndex = -1;
    if (chatSearchCount) chatSearchCount.style.display = 'none';
    if (chatSearchNav) chatSearchNav.style.display = 'none';

    if (!chatHistory) return;
    const existingMarks = chatHistory.querySelectorAll('mark.search-highlight');
    existingMarks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      const textNode = document.createTextNode(mark.textContent);
      parent.replaceChild(textNode, mark);
      parent.normalize();
    });
  }

  function buildSearchRegex(query) {
    if (!query) return null;
    const trimmed = query.trim();
    if (!trimmed) return null;
    let escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Normalize dashes (hyphen, en-dash, em-dash, minus)
    escaped = escaped.replace(/[-—–−]+/g, '[-—–−]+');
    // Normalize whitespace (standard space, NBSP \u00A0, multiple spaces)
    escaped = escaped.replace(/\s+/g, '[\\s\\u00A0]+');
    return new RegExp(`(${escaped})`, 'gi');
  }

  function collectTextNodes(element) {
    const textNodes = [];
    function recurse(el) {
      if (!el) return;
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          if (child.nodeValue && child.nodeValue.trim().length > 0) {
            textNodes.push(child);
          }
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'MARK') {
            recurse(child);
          }
        }
      }
    }
    recurse(element);
    return textNodes;
  }

  function highlightTextNode(node, regex) {
    if (!node || !node.nodeValue) return [];
    const val = node.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(val)) return [];

    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    const createdMarks = [];
    let lastIdx = 0;
    let match;

    while ((match = regex.exec(val)) !== null) {
      const matchIndex = match.index;
      const matchText = match[0];

      if (matchIndex > lastIdx) {
        fragment.appendChild(document.createTextNode(val.slice(lastIdx, matchIndex)));
      }

      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = matchText;
      fragment.appendChild(mark);
      createdMarks.push(mark);

      lastIdx = matchIndex + matchText.length;
      if (matchText.length === 0) {
        regex.lastIndex++;
      }
    }

    if (lastIdx < val.length) {
      fragment.appendChild(document.createTextNode(val.slice(lastIdx)));
    }

    if (node.parentNode) {
      node.parentNode.replaceChild(fragment, node);
    }
    return createdMarks;
  }

  function performChatSearch(query) {
    clearSearchHighlights();
    const regex = buildSearchRegex(query);
    if (!regex || !chatHistory) {
      resetSearchHideTimer();
      return;
    }

    clearTimeout(searchHideTimer);
    searchHideTimer = null;

    // Search all turn contents including user text, assistant markdown, thinking/tools, code blocks
    const targetBlocks = chatHistory.querySelectorAll('.user-content-text, .turn-markdown, .work-process-body, .code-block pre code');
    matchedMarks = [];

    targetBlocks.forEach(block => {
      const textNodes = collectTextNodes(block);
      textNodes.forEach(node => {
        const marks = highlightTextNode(node, regex);
        if (marks.length > 0) {
          matchedMarks.push(...marks);
        }
      });
    });

    const total = matchedMarks.length;

    if (total === 0) {
      if (chatSearchCount) {
        chatSearchCount.textContent = '0/0';
        chatSearchCount.style.display = 'inline-block';
      }
      if (chatSearchNav) chatSearchNav.style.display = 'none';
      currentMatchIndex = -1;
    } else {
      currentMatchIndex = 0;
      updateSearchNavDisplay();
      highlightCurrentMatch(0);
    }
  }

  function updateSearchNavDisplay() {
    const total = matchedMarks.length;
    if (total === 0) {
      if (chatSearchCount) {
        chatSearchCount.textContent = '0/0';
        chatSearchCount.style.display = 'inline-block';
      }
      if (chatSearchNav) chatSearchNav.style.display = 'none';
    } else {
      if (chatSearchCount) {
        chatSearchCount.textContent = `${currentMatchIndex + 1}/${total}`;
        chatSearchCount.style.display = 'inline-block';
      }
      if (chatSearchNav) chatSearchNav.style.display = 'inline-flex';
    }
  }

  function highlightCurrentMatch(index) {
    if (matchedMarks.length === 0) return;
    matchedMarks.forEach(m => m.classList.remove('search-highlight-current'));
    const target = matchedMarks[index];
    if (!target) return;

    target.classList.add('search-highlight-current');

    const parentDetails = target.closest('details');
    if (parentDetails && !parentDetails.open) {
      parentDetails.open = true;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateSearchNavDisplay();
  }

  function navigateSearch(direction) {
    const total = matchedMarks.length;
    if (total === 0) return;
    if (direction === 'next') {
      currentMatchIndex = (currentMatchIndex + 1) % total;
    } else {
      currentMatchIndex = (currentMatchIndex - 1 + total) % total;
    }
    highlightCurrentMatch(currentMatchIndex);
  }

  if (chatSearchInput) {
    let searchDebounceTimer = null;
    chatSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      const val = e.target.value;
      if (!val.trim()) {
        clearSearchHighlights();
        resetSearchHideTimer();
      } else {
        clearTimeout(searchHideTimer);
        searchDebounceTimer = setTimeout(() => {
          performChatSearch(val);
        }, 150);
      }
    });

    chatSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          navigateSearch('prev');
        } else {
          navigateSearch('next');
        }
      } else if (e.key === 'Escape') {
        hideChatSearchBar();
      }
    });

    chatSearchInput.addEventListener('focus', () => {
      clearTimeout(searchHideTimer);
    });

    chatSearchInput.addEventListener('blur', () => {
      resetSearchHideTimer();
    });
  }

  if (btnSearchPrev) {
    btnSearchPrev.addEventListener('click', () => navigateSearch('prev'));
  }
  if (btnSearchNext) {
    btnSearchNext.addEventListener('click', () => navigateSearch('next'));
  }
  if (btnSearchClose) {
    btnSearchClose.addEventListener('click', () => {
      if (chatSearchInput) chatSearchInput.value = '';
      clearSearchHighlights();
      hideChatSearchBar();
    });
  }

  let lastScrollTop = 0;
  chatContainer.addEventListener('scroll', () => {
    const currentScrollTop = chatContainer.scrollTop;
    const scrollDelta = lastScrollTop - currentScrollTop;
    const isScrollingUp = scrollDelta > 6;
    const isScrollingDown = scrollDelta < -6;
    lastScrollTop = currentScrollTop;

    // 대화 내용 검색창: 스크롤 업 하면 나타남 (상단 20px 이상에서)
    if (isScrollingUp && currentScrollTop > 20) {
      showChatSearchBar();
    } else if (isScrollingDown) {
      // 아무 입력없이 스크롤 다운 시 즉시 사라짐
      if (chatSearchInput && !chatSearchInput.value.trim() && document.activeElement !== chatSearchInput) {
        hideChatSearchBar();
      }
    }

    const isAtBottom = chatContainer.scrollHeight - currentScrollTop - chatContainer.clientHeight < 45;
    isAutoScroll = isAtBottom;
    if (isAtBottom) {
      btnScrollBottom.classList.remove('visible');
    } else {
      const composerEl = document.getElementById('composer');
      if (composerEl && btnScrollBottom) {
        const composerHeight = composerEl.offsetHeight || 74;
        btnScrollBottom.style.bottom = (composerHeight + 12) + 'px';
      }
      btnScrollBottom.classList.add('visible');
    }

    // Check top for infinite scroll loading of earlier messages only when scrolling upwards
    if (isScrollingUp && currentScrollTop < 120 && hasEarlierMessages && !isLoadingEarlier) {
      loadEarlierMessages();
    }
  }, { passive: true });

  btnScrollBottom.addEventListener('click', () => {
    isAutoScroll = true;
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    btnScrollBottom.classList.remove('visible');
  });

  // Auto-sync & reconnect when returning from another app or waking up
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncActiveSession(true);
    }
  });

  window.addEventListener('pageshow', () => {
    // Fired on page restore from BFCache or app resume
    syncActiveSession(true);
  });

  window.addEventListener('focus', () => {
    syncActiveSession(false);
  });

  // Safety poll: While waiting for agent response or thinking, poll every 3.5s to ensure no dropped events
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentSession) {
      const isAgentThinking = !!chatHistory.querySelector('.typing-msg');
      if (isAgentThinking || isSending) {
        syncActiveSession(false);
      }
    }
  }, 3500);

  // --- PWA Service Worker Registration & Install Prompt ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[PWA] ServiceWorker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] ServiceWorker registration failed:', err);
        });
    });
  }

  let deferredInstallPrompt = null;
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  const drawerInstallBanner = document.getElementById('drawer-install-banner');
  const btnDrawerInstallPwa = document.getElementById('btn-drawer-install-pwa');

  const setupInstallButtons = () => {
    const handleInstallClick = async () => {
      if (!deferredInstallPrompt) return;
      if (btnInstallPwa) btnInstallPwa.style.display = 'none';
      if (drawerInstallBanner) drawerInstallBanner.style.display = 'none';
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        console.log('[PWA] User choice:', choice.outcome);
      } catch (err) {
        console.error('[PWA] Error during prompt:', err);
      } finally {
        deferredInstallPrompt = null;
      }
    };

    if (btnInstallPwa) {
      btnInstallPwa.style.display = 'inline-flex';
      btnInstallPwa.onclick = handleInstallClick;
    }
    if (drawerInstallBanner && btnDrawerInstallPwa) {
      drawerInstallBanner.style.display = 'block';
      btnDrawerInstallPwa.onclick = handleInstallClick;
    }
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent default mini-infobar and save event for user action
    e.preventDefault();
    deferredInstallPrompt = e;
    setupInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed');
    deferredInstallPrompt = null;
    if (btnInstallPwa) btnInstallPwa.style.display = 'none';
    if (drawerInstallBanner) drawerInstallBanner.style.display = 'none';
  });

  // --- Fullscreen Toggle ---
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    const isFullscreenActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const updateFsBtnText = () => {
      const active = isFullscreenActive();
      btnFullscreen.innerHTML = active
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg> <span class="btn-text">창모드</span>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg> <span class="btn-text">전체화면</span>`;
    };

    btnFullscreen.addEventListener('click', async () => {
      try {
        if (!isFullscreenActive()) {
          const docEl = document.documentElement;
          if (docEl.requestFullscreen) {
            await docEl.requestFullscreen();
          } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('Fullscreen toggle failed:', err);
      }
    });

    document.addEventListener('fullscreenchange', updateFsBtnText);
    document.addEventListener('webkitfullscreenchange', updateFsBtnText);
  }

  // --- Copy & Review Action Handlers ---
  chatHistory.addEventListener('click', async (e) => {
    // 1. Copy button
    const copyBtn = e.target.closest('.turn-copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      const msgEl = copyBtn.closest('.message');
      const turn = msgEl?.__turnData;
      const textToCopy = (turn?.content || msgEl?.querySelector('.turn-markdown')?.innerText || msgEl?.querySelector('.user-content-text')?.innerText || '').trim();
      if (textToCopy) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          const iconCopy = copyBtn.querySelector('.icon-copy');
          const iconCheck = copyBtn.querySelector('.icon-check');
          copyBtn.classList.add('copied');
          if (iconCopy) iconCopy.style.display = 'none';
          if (iconCheck) iconCheck.style.display = 'inline-block';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            if (iconCopy) iconCopy.style.display = 'inline-block';
            if (iconCheck) iconCheck.style.display = 'none';
          }, 1500);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
        }
      }
      return;
    }

    // 2. Review button
    const reviewBtn = e.target.closest('.turn-review-btn');
    if (reviewBtn) {
      e.stopPropagation();
      openReviewModal();
      return;
    }

    // 3. Toggle earlier tools button
    const toggleBtn = e.target.closest('.btn-toggle-tools');
    if (toggleBtn) {
      e.stopPropagation();
      const wrap = toggleBtn.nextElementSibling;
      if (wrap && wrap.classList.contains('earlier-tools-wrap')) {
        const isHidden = wrap.style.display === 'none';
        wrap.style.display = isHidden ? 'flex' : 'none';
        const count = toggleBtn.getAttribute('data-count') || '';
        toggleBtn.innerText = isHidden
          ? `▲ 도구 실행 내역 접기 (최신 2건만 보기)`
          : `▼ 이전 도구 실행 내역 ${count}건 더보기`;
      }
      return;
    }
  });

  // --- Code Review / Diff Modal ---
  const reviewModal = document.getElementById('review-modal');
  const reviewBackdrop = document.getElementById('review-modal-backdrop');
  const reviewSubtitle = document.getElementById('review-modal-subtitle');
  const reviewBody = document.getElementById('review-modal-body');
  const reviewWebLink = document.getElementById('btn-review-web-link');
  const btnCloseReview = document.getElementById('btn-close-review');

  function openReviewModal() {
    if (!reviewModal || !currentSession) return;
    reviewModal.classList.add('open');
    if (reviewBackdrop) reviewBackdrop.classList.add('open');

    const cid = currentSession.cid || '';
    const sessionName = currentSession.name || (cid ? `rc_${cid.slice(0, 8)}` : '');

    // Configure Web remote link
    if (reviewWebLink) {
      if (cid) {
        reviewWebLink.style.display = 'inline-flex';
        fetch(`/api/remote-url?cid=${encodeURIComponent(cid)}`)
          .then(r => r.json())
          .then(d => { if (d && d.url) reviewWebLink.href = d.url; })
          .catch(() => {});
      } else {
        reviewWebLink.style.display = 'none';
      }
    }

    if (reviewSubtitle) reviewSubtitle.innerText = `${sessionName} 변경 내역 조회 중...`;
    if (reviewBody) reviewBody.innerHTML = '<div class="loading-spinner">변경 사항을 불러오는 중...</div>';

    fetch(`/api/diff?cid=${encodeURIComponent(cid)}&session=${encodeURIComponent(sessionName)}`)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.ok || !data.diff) {
          if (reviewSubtitle) reviewSubtitle.innerText = '변경된 파일이 없습니다';
          if (reviewBody) {
            reviewBody.innerHTML = `
              <div class="empty-state" style="padding: 24px 0;">
                <div style="font-size: 32px; margin-bottom: 8px;">✅</div>
                <div style="font-weight: 600; color: #f0f6fc; margin-bottom: 4px;">작업 트리에 변경 사항이 없습니다</div>
                <div style="color: #8b949e; font-size: 12px;">모든 변경 사항이 커밋되었거나 깨끗한 상태입니다.</div>
              </div>
            `;
          }
          return;
        }

        if (reviewSubtitle) {
          reviewSubtitle.innerText = data.summary || `${data.filesChanged}개 파일 변경`;
        }

        let statHtml = '';
        if (data.stat) {
          statHtml = `<div class="diff-stat-badge">📊 ${escapeHtml(data.stat.trim())}</div>`;
        }

        // Colorize diff lines
        const lines = data.diff.split('\n');
        let diffHtml = '';
        lines.forEach(line => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            diffHtml += `<span class="diff-line-add">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            diffHtml += `<span class="diff-line-del">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('diff --git') || line.startsWith('@@')) {
            diffHtml += `<span class="diff-line-header">${escapeHtml(line)}</span>`;
          } else {
            diffHtml += `${escapeHtml(line)}\n`;
          }
        });

        if (reviewBody) {
          reviewBody.innerHTML = `${statHtml}<div class="diff-content-block">${diffHtml}</div>`;
        }
      })
      .catch(err => {
        if (reviewSubtitle) reviewSubtitle.innerText = 'Diff 조회 실패';
        if (reviewBody) reviewBody.innerHTML = `<div class="empty-state"><p>조회 실패: ${escapeHtml(err.message)}</p></div>`;
      });
  }

  function closeReviewModal() {
    if (reviewModal) reviewModal.classList.remove('open');
    if (reviewBackdrop) reviewBackdrop.classList.remove('open');
  }

  if (btnCloseReview) btnCloseReview.addEventListener('click', closeReviewModal);
  if (reviewBackdrop) reviewBackdrop.addEventListener('click', closeReviewModal);

  // --- Pull-to-Refresh & Down-scroll at End Refresh ---
  const pullRefreshIndicator = document.getElementById('pull-refresh-indicator');
  let touchStartY = 0;
  let touchStartX = 0;
  let isTouching = false;
  let isRefreshing = false;

  async function triggerPullRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;

    if (pullRefreshIndicator) {
      pullRefreshIndicator.classList.add('visible');
      const textEl = pullRefreshIndicator.querySelector('.pull-refresh-text');
      if (textEl) textEl.innerText = '대화 새로고침 중...';
    }

    try {
      if (currentSession) {
        await selectSession(currentSession);
      }
      await fetchSessions();
    } catch (err) {
      console.warn('Refresh failed:', err);
    } finally {
      setTimeout(() => {
        if (pullRefreshIndicator) {
          pullRefreshIndicator.classList.remove('visible');
          const textEl = pullRefreshIndicator.querySelector('.pull-refresh-text');
          if (textEl) textEl.innerText = '당겨서 새로고침';
        }
        isRefreshing = false;
      }, 500);
    }
  }

  chatContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      isTouching = true;
    }
  }, { passive: true });

  chatContainer.addEventListener('touchmove', (e) => {
    if (!isTouching || isRefreshing || e.touches.length !== 1) return;
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const deltaY = currentY - touchStartY;
    const deltaX = currentX - touchStartX;

    // 수평 스와이프 제스처(손날 캡처, 뒤로가기 제스처 등) 중에는 pull-to-refresh 무시
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (pullRefreshIndicator) pullRefreshIndicator.classList.remove('visible');
      return;
    }

    const isAtTop = chatContainer.scrollTop <= 5;

    // Trigger feedback only when user drags downwards from top edge (pull-to-refresh)
    if (deltaY > 0 && isAtTop) {
      const pullDist = Math.min(deltaY * 0.45, 90);
      if (pullDist > 15 && pullRefreshIndicator) {
        pullRefreshIndicator.classList.add('visible');
        const textEl = pullRefreshIndicator.querySelector('.pull-refresh-text');
        if (textEl) {
          textEl.innerText = pullDist > 55 ? '놓으면 새로고침' : '당겨서 새로고침';
        }
      }
    }
  }, { passive: true });

  chatContainer.addEventListener('touchend', (e) => {
    if (!isTouching || isRefreshing) {
      isTouching = false;
      return;
    }
    isTouching = false;
    const currentY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : touchStartY;
    const currentX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchStartX;
    const deltaY = currentY - touchStartY;
    const deltaX = currentX - touchStartX;

    // 수평 제스처였던 경우 새로고침 무시
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (pullRefreshIndicator) pullRefreshIndicator.classList.remove('visible');
      return;
    }

    const isAtTop = chatContainer.scrollTop <= 10;

    // Only refresh when pulled down from top edge (prevent bottom scroll jitter)
    if (deltaY > 60 && isAtTop) {
      triggerPullRefresh();
    } else if (pullRefreshIndicator) {
      pullRefreshIndicator.classList.remove('visible');
    }
  }, { passive: true });

  // ============================================================================
  // Model Picker & Voice Recognition (Antigravity 2.0 Feature Set)
  // ============================================================================

  const MODEL_STORAGE_KEY = 'agy_selected_model_id';
  const EFFORT_STORAGE_KEY = 'agy_selected_effort';

  let selectedEffort = localStorage.getItem(EFFORT_STORAGE_KEY) || 'high'; // 'low' | 'mid' | 'high'

  let availableModels = [
    {
      id: 'gemini-3.8-flash-high',
      displayName: 'Gemini 3.8 Flash',
      subLabel: 'High',
      chipLabel: 'Gemini 3.8 Flash High',
      model: 'MODEL_PLACEHOLDER_M318',
      disabled: false
    },
    {
      id: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6 (Thinking)',
      subLabel: 'Notice ⓘ',
      chipLabel: 'Claude Sonnet 4.6',
      tagTitle: 'Notice',
      tagDescription: 'Sonnet 5.5 is now available on paid Pro and Ultra plans.',
      model: 'MODEL_PLACEHOLDER_M35',
      disabled: false
    },
    {
      id: 'claude-opus-4-6-thinking',
      displayName: 'Claude Opus 4.6 (Thinking)',
      subLabel: 'Notice ⓘ',
      chipLabel: 'Claude Opus 4.6',
      tagTitle: 'Notice',
      tagDescription: 'Opus 5.5 is now available on paid Pro and Ultra plans.',
      model: 'MODEL_PLACEHOLDER_M26',
      disabled: false
    },
    {
      id: 'gpt-oss-120b-medium',
      displayName: 'GPT-OSS 120B (Medium)',
      subLabel: 'Notice ⓘ',
      chipLabel: 'GPT-OSS 120B',
      tagTitle: 'Notice',
      tagDescription: 'GPT-OSS will be removed on November 2, 2026.',
      model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
      disabled: false
    },
    {
      id: 'gemini-4-argon-disabled',
      displayName: 'Gemini 4 Argon',
      subLabel: 'Unavailable ⓘ',
      chipLabel: 'Gemini 4 Argon',
      tagTitle: 'Unavailable',
      tagDescription: 'Gemini 4 Argon is currently available to Ultra and paid Pro subscribers.',
      model: 'MODEL_PLACEHOLDER_M421',
      disabled: true
    }
  ];

  let selectedModelId = localStorage.getItem(MODEL_STORAGE_KEY) || 'gemini-3.8-flash-high';

  function getSelectedModel() {
    return availableModels.find(m => m.id === selectedModelId) || availableModels[0];
  }

  function getEffortLabel(effort) {
    if (effort === 'low') return 'Low';
    if (effort === 'mid') return 'Mid';
    return 'High';
  }

  function updateEffortControlUI() {
    if (!modelEffortGroup) return;
    const buttons = modelEffortGroup.querySelectorAll('.effort-btn');
    buttons.forEach(btn => {
      if (btn.dataset.effort === selectedEffort) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function setEffort(effort) {
    selectedEffort = effort;
    localStorage.setItem(EFFORT_STORAGE_KEY, selectedEffort);
    updateEffortControlUI();

    // Gemini 3.8 계열인 경우 모델 ID도 effort에 맞춰 자동 동기화
    if (selectedModelId.startsWith('gemini-3.8-flash')) {
      if (effort === 'low') {
        selectedModelId = 'gemini-3.8-flash-low';
      } else if (effort === 'mid') {
        selectedModelId = 'gemini-3.8-flash-medium';
      } else {
        selectedModelId = 'gemini-3.8-flash-high';
      }
      localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId);
    }

    updateModelChipDisplay();
    renderModelList();
  }

  function updateModelChipDisplay() {
    const current = getSelectedModel();
    if (!modelPickerName || !current) return;

    const effortLabel = getEffortLabel(selectedEffort);
    if (current.id.startsWith('gemini-3.8-flash')) {
      modelPickerName.innerText = `Gemini 3.8 Flash ${effortLabel}`;
    } else if (current.displayName.includes('Claude') || current.displayName.includes('GPT')) {
      modelPickerName.innerText = `${current.displayName.replace(/ \(.*?\)/, '')} (${effortLabel})`;
    } else {
      modelPickerName.innerText = current.chipLabel || `${current.displayName} ${current.subLabel || ''}`.trim();
    }
  }

  function openModelPicker() {
    updateEffortControlUI();
    renderModelList();
    if (modelPickerSheet) modelPickerSheet.classList.add('visible');
    if (modelPickerBackdrop) modelPickerBackdrop.classList.add('visible');
  }

  function closeModelPicker() {
    if (modelPickerSheet) modelPickerSheet.classList.remove('visible');
    if (modelPickerBackdrop) modelPickerBackdrop.classList.remove('visible');
  }

  function renderModelList() {
    if (!modelSheetList) return;
    modelSheetList.innerHTML = '';

    // Gemini 3.8 계열은 현재 선택된 effort 버전에 매칭
    const currentActiveBase = selectedModelId.startsWith('gemini-3.8-flash')
      ? 'gemini-3.8-flash'
      : selectedModelId;

    availableModels.forEach(m => {
      // Gemini 3.8 flash 하위 변종(low/medium)은 메인 목록에서 중복 표시하지 않고 하나로 통합 렌더링
      if (m.id === 'gemini-3.8-flash-medium' || m.id === 'gemini-3.8-flash-low') {
        return;
      }

      const isCurrentActive = m.id.startsWith('gemini-3.8-flash')
        ? currentActiveBase === 'gemini-3.8-flash'
        : m.id === selectedModelId;

      const itemEl = document.createElement('div');
      itemEl.className = `model-item ${isCurrentActive ? 'active' : ''} ${m.disabled ? 'disabled' : ''}`;

      let badgeHtml = '';
      if (m.id.startsWith('gemini-3.8-flash')) {
        badgeHtml = `<span class="model-item-sub">${getEffortLabel(selectedEffort)}</span>`;
      } else if (m.subLabel) {
        if (m.subLabel === 'High' || m.subLabel === 'Medium' || m.subLabel === 'Low') {
          badgeHtml = `<span class="model-item-sub">${escapeHtml(m.subLabel)}</span>`;
        } else {
          badgeHtml = `<span class="model-item-badge">${escapeHtml(m.subLabel)}</span>`;
        }
      }

      itemEl.innerHTML = `
        <div class="model-item-main">
          <span class="model-item-name">${escapeHtml(m.displayName.replace(/ \((High|Medium|Low)\)/, ''))}</span>
          ${badgeHtml}
        </div>
        <div class="model-item-actions">
          <svg class="model-check-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <svg class="model-chevron-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      `;

      if (!m.disabled) {
        itemEl.addEventListener('click', () => {
          if (m.id.startsWith('gemini-3.8-flash')) {
            if (selectedEffort === 'low') {
              selectedModelId = 'gemini-3.8-flash-low';
            } else if (selectedEffort === 'mid') {
              selectedModelId = 'gemini-3.8-flash-medium';
            } else {
              selectedModelId = 'gemini-3.8-flash-high';
            }
          } else {
            selectedModelId = m.id;
          }
          localStorage.setItem(MODEL_STORAGE_KEY, selectedModelId);
          updateModelChipDisplay();
          renderModelList();
          closeModelPicker();
        });
      }

      modelSheetList.appendChild(itemEl);
    });
  }

  async function fetchServerModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          availableModels = data.models.map(m => ({
            ...m,
            chipLabel: m.chipLabel || `${m.displayName} ${m.subLabel || ''}`.trim()
          }));
          updateModelChipDisplay();
          renderModelList();
        }
      }
    } catch (e) {
      // Keep presets
    }
  }

  function initModelPicker() {
    updateEffortControlUI();
    updateModelChipDisplay();

    if (btnModelPicker) {
      btnModelPicker.addEventListener('click', openModelPicker);
    }
    if (modelPickerBackdrop) {
      modelPickerBackdrop.addEventListener('click', closeModelPicker);
    }
    const handle = modelPickerSheet ? modelPickerSheet.querySelector('.sheet-drag-handle') : null;
    if (handle) {
      handle.addEventListener('click', closeModelPicker);
    }

    if (modelEffortGroup) {
      modelEffortGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.effort-btn');
        if (btn && btn.dataset.effort) {
          setEffort(btn.dataset.effort);
        }
      });
    }

    if (btnViewUsage) {
      btnViewUsage.addEventListener('click', () => {
        openUsageModal();
      });
    }

    initUsageModal();
    fetchServerModels();
  }

  // ============================================================================
  // Plan Usage & Quotas Bottom Sheet Modal Logic
  // ============================================================================

  function openUsageModal() {
    closeModelPicker();
    if (usageModalSheet) usageModalSheet.classList.add('visible');
    if (usageModalBackdrop) usageModalBackdrop.classList.add('visible');
    loadUsageData();
  }

  function closeUsageModal() {
    if (usageModalSheet) usageModalSheet.classList.remove('visible');
    if (usageModalBackdrop) usageModalBackdrop.classList.remove('visible');
  }

  async function loadUsageData() {
    if (!usageSheetContent) return;
    usageSheetContent.innerHTML = `
      <div style="padding: 24px 0; text-align: center; color: #9aa0a6;">
        <div class="thinking-spinner" style="margin: 0 auto 10px auto;"></div>
        <div>사용량 및 할당량 정보를 조회하는 중...</div>
      </div>
    `;

    try {
      const res = await fetch('/api/usage');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderUsageContent(data);
    } catch (err) {
      usageSheetContent.innerHTML = `
        <div style="padding: 20px 10px; text-align: center; color: #f28b82;">
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 6px;">사용량 정보를 불러오지 못했습니다.</div>
          <div style="font-size: 12px; color: #9aa0a6; margin-bottom: 14px;">${escapeHtml(err.message)}</div>
          <button class="usage-refresh-btn" id="btn-retry-usage">다시 시도</button>
        </div>
      `;
      const retryBtn = document.getElementById('btn-retry-usage');
      if (retryBtn) retryBtn.addEventListener('click', loadUsageData);
    }
  }

  function renderUsageContent(data) {
    if (!usageSheetContent) return;
    const groups = data.groups || [];

    if (groups.length === 0) {
      usageSheetContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #9aa0a6;">사용량 데이터가 없습니다.</div>';
      return;
    }

    let html = '';
    groups.forEach(group => {
      html += `
        <div class="usage-group-card">
          <div class="usage-group-header">
            <span class="usage-group-title">${escapeHtml(group.displayName)}</span>
            <span class="usage-group-desc">${escapeHtml(group.description || '')}</span>
          </div>
      `;

      const buckets = group.buckets || [];
      buckets.forEach(bucket => {
        const rawFraction = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : 1;
        const percent = Math.max(0, Math.min(100, Math.round(rawFraction * 100)));
        const levelClass = percent >= 50 ? 'high' : (percent >= 20 ? 'mid' : 'low');

        html += `
          <div class="usage-bucket-item">
            <div class="usage-bucket-row">
              <span class="usage-bucket-name">${escapeHtml(bucket.displayName)}</span>
              <span class="usage-bucket-percent ${levelClass}">${percent}% 남음</span>
            </div>
            <div class="usage-bar-track">
              <div class="usage-bar-fill ${levelClass}" style="width: ${percent}%;"></div>
            </div>
            <div class="usage-bucket-desc">${escapeHtml(bucket.description || '')}</div>
          </div>
        `;
      });

      html += `</div>`;
    });

    if (data.description) {
      html += `
        <div class="usage-policy-box">
          <div class="usage-policy-text">${escapeHtml(data.description)}</div>
        </div>
      `;
    }

    html += `
      <div class="usage-refresh-btn-wrap">
        <button class="usage-refresh-btn" id="btn-refresh-usage">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          <span>새로고침</span>
        </button>
      </div>
    `;

    usageSheetContent.innerHTML = html;

    const refreshBtn = document.getElementById('btn-refresh-usage');
    if (refreshBtn) refreshBtn.addEventListener('click', loadUsageData);
  }

  function initUsageModal() {
    if (btnCloseUsage) {
      btnCloseUsage.addEventListener('click', closeUsageModal);
    }
    if (usageModalBackdrop) {
      usageModalBackdrop.addEventListener('click', closeUsageModal);
    }
    const handle = usageModalSheet ? usageModalSheet.querySelector('.sheet-drag-handle') : null;
    if (handle) {
      handle.addEventListener('click', closeUsageModal);
    }
  }

  // --- Voice Recognition ---
  let recognition = null;
  let isRecording = false;
  let recordingSeconds = 0;
  let recordingTimerInterval = null;
  let textBeforeRecording = '';

  function formatRecordingTimer(secs) {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  }

  function startVoiceRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('사용하시는 브라우저가 음성 인식(Web Speech API)을 지원하지 않습니다.');
      return;
    }

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';

      textBeforeRecording = composerInput.value;
      let finalTranscript = '';

      recognition.onstart = () => {
        isRecording = true;
        recordingSeconds = 0;
        if (voiceRecTimer) voiceRecTimer.innerText = '0:00';
        if (voiceRecordingBar) voiceRecordingBar.style.display = 'flex';
        if (btnVoice) btnVoice.classList.add('recording');

        clearInterval(recordingTimerInterval);
        recordingTimerInterval = setInterval(() => {
          recordingSeconds++;
          if (voiceRecTimer) voiceRecTimer.innerText = formatRecordingTimer(recordingSeconds);
        }, 1000);
      };

      recognition.onresult = (event) => {
        let interim = '';
        finalTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const currentSpoken = (finalTranscript + ' ' + interim).trim();
        const separator = (textBeforeRecording && !textBeforeRecording.endsWith(' ')) ? ' ' : '';
        composerInput.value = textBeforeRecording ? (textBeforeRecording + separator + currentSpoken) : currentSpoken;
        composerInput.style.height = 'auto';
        composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + 'px';
        updateSendButtonState();
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
          alert('마이크 접근 권한이 거부되었습니다. 브라우저 설정에서 마이크를 허용해주세요.');
        }
        stopVoiceRecording(true);
      };

      recognition.onend = () => {
        if (isRecording) {
          stopVoiceRecording(true);
        }
      };

      recognition.start();
    } catch (err) {
      console.error('음성 인식 시작 오류:', err);
      stopVoiceRecording(true);
    }
  }

  function stopVoiceRecording(commitText = true) {
    isRecording = false;
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;

    if (voiceRecordingBar) voiceRecordingBar.style.display = 'none';
    if (btnVoice) btnVoice.classList.remove('recording');

    if (recognition) {
      try {
        if (commitText) {
          recognition.stop();
        } else {
          recognition.abort();
        }
      } catch (e) {}
      recognition = null;
    }

    if (!commitText) {
      composerInput.value = textBeforeRecording;
      composerInput.style.height = 'auto';
      composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + 'px';
      updateSendButtonState();
    }
  }

  function initVoiceRecognition() {
    if (btnVoice) {
      btnVoice.addEventListener('click', (e) => {
        e.preventDefault();
        if (isRecording) {
          stopVoiceRecording(true);
        } else {
          startVoiceRecording();
        }
      });
    }
    if (btnVoiceStop) {
      btnVoiceStop.addEventListener('click', (e) => {
        e.preventDefault();
        stopVoiceRecording(true);
      });
    }
    if (btnVoiceCancel) {
      btnVoiceCancel.addEventListener('click', (e) => {
        e.preventDefault();
        stopVoiceRecording(false);
      });
    }
  }

  // --- Initial Load ---
  initModelPicker();
  initVoiceRecognition();

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
