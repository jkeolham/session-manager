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

  // Drawer New Conversation Elements
  const drawerComposerInput = document.getElementById('drawer-composer-input');
  const btnDrawerSend = document.getElementById('btn-drawer-send');
  const btnDrawerNew = document.getElementById('btn-drawer-new');
  const btnDrawerModelPicker = document.getElementById('btn-drawer-model-picker');
  const drawerModelName = document.getElementById('drawer-model-name');

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

  // --- Markdown Parser with Marked.js & GFM Support (Dashboard Grade) ---
  if (typeof marked !== 'undefined' && marked.use) {
    const defaultTable = marked.Renderer.prototype.table;
    marked.use({
      gfm: true,
      breaks: true,
      renderer: {
        table(token) {
          const html = defaultTable.call(this, token);
          return `<div class="table-container">${html}</div>`;
        },
        code(token) {
          const lang = token.lang ? token.lang.trim() : 'code';
          const cleanCode = token.text || '';
          return `
            <div class="code-block">
              <div class="code-header">
                <span>${escapeHtml(lang)}</span>
                <button class="copy-btn" onclick="window.copyCodeBlock(this)">복사</button>
              </div>
              <pre><code>${escapeHtml(cleanCode)}</code></pre>
            </div>
          `;
        },
        link(token) {
          const href = token.href || '#';
          const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
          const text = this.parser.parseInline(token.tokens);
          return `<a class="markdown-link" href="${escapeHtml(href)}"${title} target="_blank" rel="noopener">${text}</a>`;
        }
      }
    });
  }

  // --- LaTeX / Math Symbol Map for Robust Fallback & Direct Replacements ---
  const LATEX_SYMBOLS = {
    '\\rightarrow': '→', '\\to': '→',
    '\\leftarrow': '←', '\\gets': '←',
    '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
    '\\leftrightarrow': '↔', '\\Leftrightarrow': '⇔',
    '\\uparrow': '↑', '\\downarrow': '↓',
    '\\nearrow': '↗', '\\searrow': '↘', '\\swarrow': '↙', '\\nwarrow': '↖',
    '\\pm': '±', '\\mp': '∓',
    '\\times': '×', '\\div': '÷', '\\cdot': '·', '\\bullet': '•',
    '\\neq': '≠', '\\ne': '≠',
    '\\le': '≤', '\\leq': '≤',
    '\\ge': '≥', '\\geq': '≥',
    '\\approx': '≈', '\\sim': '∼', '\\equiv': '≡',
    '\\ll': '≪', '\\gg': '≫',
    '\\in': '∈', '\\notin': '∉',
    '\\subset': '⊂', '\\subseteq': '⊆',
    '\\supset': '⊃', '\\supseteq': '⊇',
    '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅',
    '\\forall': '∀', '\\exists': '∃', '\\nexists': '∄',
    '\\neg': '¬', '\\land': '∧', '\\lor': '∨',
    '\\infty': '∞', '\\sum': '∑', '\\prod': '∏', '\\int': '∫',
    '\\partial': '∂', '\\nabla': '∇',
    '\\degree': '°', '\\circ': '°', '\\ast': '∗', '\\star': '⋆',
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
    '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ',
    '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
    '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
    '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
    '\\Psi': 'Ψ', '\\Omega': 'Ω',
    '\\dots': '…', '\\ldots': '…', '\\cdots': '⋯'
  };

  function replaceLatexSymbols(str) {
    if (!str) return '';
    let res = str;
    for (const [cmd, sym] of Object.entries(LATEX_SYMBOLS)) {
      const esc = cmd.replace(/\\/g, '\\\\');
      const reg = new RegExp(esc + '(?![a-zA-Z])', 'g');
      res = res.replace(reg, sym);
    }
    return res;
  }

  function renderMathExpression(expr, isDisplay = false) {
    const trimmed = (expr || '').trim();
    if (!trimmed) return '';

    // 1. KaTeX 사용 가능 시 완전한 KaTeX 렌더링
    if (typeof katex !== 'undefined' && typeof katex.renderToString === 'function') {
      try {
        return katex.renderToString(trimmed, {
          displayMode: isDisplay,
          throwOnError: false
        });
      } catch (err) {
        console.warn('KaTeX render error:', err);
      }
    }

    // 2. Fallback: LaTeX 심볼 변환 + 인라인/블록 태그
    const replaced = replaceLatexSymbols(escapeHtml(trimmed));
    return isDisplay
      ? `<div class="math-block">${replaced}</div>`
      : `<span class="inline-math">${replaced}</span>`;
  }

  function fallbackParseMarkdown(text) {
    let parsed = text;
    // 1. Code blocks
    const codeBlocks = [];
    parsed = parsed.replace(/```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g, (match, lang, code) => {
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

    // 2. Tables
    parsed = parsed.replace(/^\|(.+)\|\r?\n\|([-: |]+)\|\r?\n((?:\|.*\|\r?\n?)*)/gm, (match, headerLine, alignLine, bodyLines) => {
      const formatCell = (c) => {
        let t = escapeHtml(c);
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        return t;
      };
      const headers = headerLine.split('|').map(h => h.trim()).filter(h => h.length > 0);
      const rows = bodyLines.trim().split('\n').map(row => row.split('|').map(c => c.trim()).filter(c => c.length > 0));
      let ths = headers.map(h => `<th>${formatCell(h)}</th>`).join('');
      let trs = rows.map(r => `<tr>${r.map(c => `<td>${formatCell(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="table-container"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    });

    // 3. Headings
    parsed = parsed.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    parsed = parsed.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    parsed = parsed.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    parsed = parsed.replace(/^---$/gim, '<hr>');

    // 4. Inline formatting
    parsed = parsed.replace(/`([^`\n]+)`/g, (m, c) => `<code>${escapeHtml(c)}</code>`);
    parsed = parsed.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    parsed = parsed.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="markdown-link" href="$2" target="_blank" rel="noopener">$1</a>');
    parsed = parsed.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    parsed = parsed.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Paragraphs
    const paragraphs = parsed.split(/\n{2,}/);
    parsed = paragraphs
      .map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('__CODE_BLOCK_') || p.startsWith('<ul>') || p.startsWith('<details') || p.startsWith('<div') || p.startsWith('<h') || p.startsWith('<hr')) {
          return p;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    codeBlocks.forEach((block, idx) => {
      parsed = parsed.replace(`__CODE_BLOCK_${idx}__`, block);
    });

    return parsed;
  }

  function renderMarkdown(rawText) {
    if (!rawText) return '';
    let text = String(rawText);

    // 1. 코드 블록 및 인라인 코드 임시 보호 (코드 안의 $나 \를 수식 변환으로부터 보호)
    const codeProtections = [];
    text = text.replace(/```[a-zA-Z0-9_\-\.]*\n[\s\S]*?```/g, (m) => {
      const idx = codeProtections.length;
      codeProtections.push(m);
      return `%%PROTECTED_CODE_${idx}%%`;
    });
    text = text.replace(/`[^`\n]+`/g, (m) => {
      const idx = codeProtections.length;
      codeProtections.push(m);
      return `%%PROTECTED_CODE_${idx}%%`;
    });

    // 2. 수식 및 기호 추출 (블록 수식 $$...$$ 및 인라인 수식 $...$)
    const mathTokens = [];

    // 2-1. 블록 수식 $$ ... $$
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, expr) => {
      const idx = mathTokens.length;
      const html = `<div class="math-block">${renderMathExpression(expr, true)}</div>`;
      mathTokens.push(html);
      return `%%MATH_TOKEN_${idx}%%`;
    });

    // 2-2. 인라인 수식 $ ... $
    text = text.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g, (m, expr) => {
      const trimmed = expr.trim();
      // 단순 금액 기호 ($10, $50.00 등)는 수식 치환 제외
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) return m;

      const idx = mathTokens.length;
      const html = renderMathExpression(trimmed, false);
      mathTokens.push(html);
      return `%%MATH_TOKEN_${idx}%%`;
    });

    // 2-3. $ 기호 없이 본문에 노출된 일반 LaTeX 기호 치환 (\rightarrow 등)
    text = replaceLatexSymbols(text);

    // 2-4. 마크다운 파서 전에 코드 블록 복원 (함수형 콜백으로 $1, $& 등 특수 패턴 해석 방지)
    codeProtections.forEach((codeStr, idx) => {
      text = text.replace(`%%PROTECTED_CODE_${idx}%%`, () => codeStr);
    });

    // 3. Marked GFM 파싱 실행
    let parsed = '';
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      try {
        parsed = marked.parse(text);
      } catch (err) {
        console.warn('Marked parse error, falling back:', err);
        parsed = fallbackParseMarkdown(text);
      }
    } else {
      parsed = fallbackParseMarkdown(text);
    }

    // 4. 수식 토큰 복원 (<p> 언래핑 및 함수형 콜백으로 수식 HTML 내 특수문자 보존)
    mathTokens.forEach((tokenHtml, idx) => {
      const tokenStr = `%%MATH_TOKEN_${idx}%%`;
      const pWrapped = new RegExp(`<p>\\s*${tokenStr}\\s*<\\/p>`, 'g');
      if (pWrapped.test(parsed)) {
        parsed = parsed.replace(pWrapped, () => tokenHtml);
      } else {
        parsed = parsed.replace(tokenStr, () => tokenHtml);
      }
    });

    // 5. XSS 방어: DOMPurify로 최종 소독 (KaTeX MathML 태그 및 SVG 보존)
    return sanitizeHtml(parsed);
  }

  function sanitizeHtml(dirtyHtml) {
    if (!dirtyHtml) return '';
    if (typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function') {
      try {
        return DOMPurify.sanitize(dirtyHtml, {
          ADD_TAGS: [
            'math', 'semantics', 'annotation', 'annotation-xml',
            'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup',
            'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd',
            'mtext', 'mspace', 'munder', 'mover', 'munderover',
            'mpadded', 'mphantom', 'menclose'
          ],
          ADD_ATTR: ['target', 'rel', 'display', 'xmlns', 'encoding']
        });
      } catch (err) {
        console.warn('DOMPurify error, returning dirtyHtml:', err);
      }
    }
    return dirtyHtml;
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
    closeSessionActionMenu();
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
          <div class="session-item ${activeClass}" data-session="${escapeHtml(JSON.stringify(item))}" data-category="${escapeHtml(cat.key)}">
            <div class="session-item-info">
              <div class="session-item-name">${escapeHtml(displayName)}</div>
              ${subName ? `<div class="session-item-title">${escapeHtml(subName)}</div>` : ''}
            </div>
            <div class="session-item-right">
              ${statusHtml ? `<div class="session-status-indicator">${statusHtml}</div>` : ''}
              <button class="session-more-btn" type="button" aria-label="추가 옵션" title="추가 옵션">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2.2"></circle>
                  <circle cx="12" cy="12" r="2.2"></circle>
                  <circle cx="12" cy="19" r="2.2"></circle>
                </svg>
              </button>
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
    sessionListEl.querySelectorAll('.session-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSessionActionMenu(btn);
      });
    });

    sessionListEl.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', () => {
        closeSessionActionMenu();
        const dataStr = el.getAttribute('data-session');
        if (dataStr) {
          const session = JSON.parse(dataStr);
          selectSession(session);
          closeDrawer();
        }
      });
    });
  }

  // --- Global Toast Notification ---
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById('global-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    // Force DOM reflow for CSS transition
    void toast.offsetWidth;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        if (!toast.classList.contains('visible')) {
          toast.classList.add('hidden');
        }
      }, 200);
    }, 2000);
  }

  // --- Session Item Action Menu (Kebab Dropdown) ---
  const sessionActionMenu = document.getElementById('session-action-menu');

  function openSessionActionMenu(btn) {
    if (!sessionActionMenu) return;

    // Toggle: if clicking the active button again, close menu
    if (sessionActionMenu.__targetBtn === btn && !sessionActionMenu.classList.contains('hidden')) {
      closeSessionActionMenu();
      return;
    }

    closeSessionActionMenu();

    const itemEl = btn.closest('.session-item');
    if (!itemEl) return;
    const sessionDataStr = itemEl.getAttribute('data-session');
    if (!sessionDataStr) return;
    const sessionData = JSON.parse(sessionDataStr);
    const catKey = itemEl.getAttribute('data-category') || '';

    // Configure action visibility
    const copyId = sessionData.cid || sessionData.name || '';
    const copyBtn = sessionActionMenu.querySelector('[data-action="copy-id"]');
    const deleteBtn = sessionActionMenu.querySelector('[data-action="delete"]');

    if (copyBtn) {
      copyBtn.style.display = copyId ? 'flex' : 'none';
      copyBtn.setAttribute('data-copy-id', copyId);
    }

    if (deleteBtn) {
      deleteBtn.style.display = (catKey === 'agy' && sessionData.cid) ? 'flex' : 'none';
    }

    sessionActionMenu.__targetSession = sessionData;
    sessionActionMenu.__targetItemEl = itemEl;
    sessionActionMenu.__targetBtn = btn;
    btn.classList.add('active');

    sessionActionMenu.classList.remove('hidden');
    sessionActionMenu.setAttribute('aria-hidden', 'false');

    // Position menu relative to button
    const rect = btn.getBoundingClientRect();
    const menuWidth = sessionActionMenu.offsetWidth || 154;
    const menuHeight = sessionActionMenu.offsetHeight || 110;

    let top = rect.bottom + 6;
    let left = rect.right - menuWidth;

    // Flip up if bottom overflows viewport
    if (top + menuHeight > window.innerHeight - 10) {
      top = rect.top - menuHeight - 6;
    }
    // Prevent left edge overflow
    if (left < 10) {
      left = 10;
    }

    sessionActionMenu.style.top = `${Math.round(top)}px`;
    sessionActionMenu.style.left = `${Math.round(left)}px`;
  }

  function closeSessionActionMenu() {
    if (!sessionActionMenu || sessionActionMenu.classList.contains('hidden')) return;
    if (sessionActionMenu.__targetBtn) {
      sessionActionMenu.__targetBtn.classList.remove('active');
    }
    sessionActionMenu.classList.add('hidden');
    sessionActionMenu.setAttribute('aria-hidden', 'true');
    sessionActionMenu.__targetSession = null;
    sessionActionMenu.__targetItemEl = null;
    sessionActionMenu.__targetBtn = null;
  }

  function initSessionActionMenu() {
    if (!sessionActionMenu) return;

    // Handle menu item actions
    sessionActionMenu.addEventListener('click', async (e) => {
      const itemBtn = e.target.closest('.session-action-item');
      if (!itemBtn) return;
      e.stopPropagation();

      const action = itemBtn.getAttribute('data-action');
      const session = sessionActionMenu.__targetSession;
      const itemEl = sessionActionMenu.__targetItemEl;

      closeSessionActionMenu();

      if (!session) return;

      if (action === 'copy-id') {
        const copyText = session.cid || session.name || '';
        if (copyText) {
          try {
            await navigator.clipboard.writeText(copyText);
            showToast('세션 ID가 복사되었습니다.');
          } catch (err) {
            console.error('Failed to copy session id:', err);
            prompt('세션 ID를 복사하세요:', copyText);
          }
        }
      } else if (action === 'rename') {
        renameSession(session, itemEl);
      } else if (action === 'delete') {
        deleteSession(session);
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#session-action-menu') && !e.target.closest('.session-more-btn')) {
        closeSessionActionMenu();
      }
    });

    // Close on drawer scroll
    const drawerContent = document.getElementById('drawer-content');
    if (drawerContent) {
      drawerContent.addEventListener('scroll', closeSessionActionMenu, { passive: true });
    }

    // Close on window resize & ESC key
    window.addEventListener('resize', closeSessionActionMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSessionActionMenu();
    });
  }

  // Rename session (Antigravity conversation title or tmux session)
  async function renameSession(session, itemEl) {
    const currentTitle = session.title || session.name || '';
    const newTitle = prompt('새 세션 이름을 입력하세요:', currentTitle);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) {
      return;
    }

    const trimmed = newTitle.trim();
    try {
      const payload = session.cid
        ? { cid: session.cid, title: trimmed }
        : { session: session.name, newName: trimmed };

      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        alert(`세션 이름 변경 실패: ${data.error || '알 수 없는 오류'}`);
        return;
      }

      // Update session object
      session.title = trimmed;
      if (data.type === 'tmux') {
        session.name = trimmed;
      }
      if (itemEl) {
        itemEl.setAttribute('data-session', JSON.stringify(session));
        const nameEl = itemEl.querySelector('.session-item-name');
        if (nameEl) {
          nameEl.innerText = trimmed;
        }
      }

      // If active session, update header title
      if (currentSession && (
        (currentSession.cid && currentSession.cid === session.cid) ||
        (currentSession.name && currentSession.name === session.name)
      )) {
        currentSession.title = trimmed;
        if (data.type === 'tmux') currentSession.name = trimmed;
        const headerTitleEl = document.getElementById('current-session-title');
        if (headerTitleEl) {
          headerTitleEl.innerText = trimmed;
        }
      }

      // Refresh session list in background
      await fetchSessions();
      showToast('세션 이름이 변경되었습니다.');
    } catch (err) {
      console.error('Failed to rename session:', err);
      alert(`세션 이름 변경 중 오류가 발생했습니다: ${err.message}`);
    }
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
          if (turn.questionData) {
            prev.questionData = turn.questionData;
          }
          prev.index = turn.index || prev.index;
          prev.timestamp = turn.timestamp || prev.timestamp;
        } else {
          grouped.push({
            ...turn,
            thinkings: turn.thinking ? [turn.thinking.trim()] : [],
            toolCalls: Array.isArray(turn.toolCalls) ? [...turn.toolCalls] : [],
            questionData: turn.questionData || null
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

  function formatClaudeTool(tc) {
    const name = tc.name || 'tool';
    const args = tc.args || {};
    let type = 'Tool';
    let target = tc.label || tc.summary || '';

    if (name === 'run_command' || name === 'bash' || name === 'terminal') {
      type = 'Bash';
      target = args.CommandLine || target || 'command';
      if (target.length > 55) target = target.slice(0, 52) + '...';
    } else if (name === 'read_file') {
      type = 'Read';
      const p = args.Path || args.path || target;
      target = p.split('/').pop() || p;
    } else if (name === 'edit_file') {
      type = 'Edit';
      const p = args.Path || args.path || target;
      target = p.split('/').pop() || p;
    } else if (name === 'write_file') {
      type = 'Write';
      const p = args.Path || args.path || target;
      target = p.split('/').pop() || p;
    } else if (name === 'search_web' || name === 'web_search') {
      type = 'Search';
      target = args.query || target || 'web';
    } else {
      type = name;
      if (!target && Object.keys(args).length > 0) {
        target = Object.values(args)[0];
        if (typeof target !== 'string') target = JSON.stringify(target);
      }
    }
    return { type, target, raw: tc };
  }

  function renderQuestionCardHtml(qData, turnIndex) {
    if (!qData || !Array.isArray(qData.questions) || qData.questions.length === 0) return '';
    const isPending = !!qData.isPending;
    const isAnswered = !!qData.isAnswered;

    return qData.questions.map((q, qIdx) => {
      const isMulti = !!q.is_multi_select;
      const inputType = isMulti ? 'checkbox' : 'radio';
      const inputName = `q_${turnIndex || 'latest'}_${qIdx}`;

      const optionsHtml = (q.options || []).map((opt, optIdx) => {
        const optText = typeof opt === 'object' && opt !== null ? (opt.text || '') : String(opt);
        const optId = typeof opt === 'object' && opt !== null ? String(opt.id || optIdx + 1) : String(optIdx + 1);
        const isRec = optText.includes('(Recommended)');
        const cleanOpt = optText.replace(/^\(Recommended\)\s*/i, '').trim();
        // 기본 선택: 추천 옵션이거나 첫 번째 옵션
        const isChecked = isPending && (isRec || optIdx === 0);

        return `
          <label class="question-option-item ${isRec ? 'recommended' : ''}">
            <input type="${inputType}" name="${inputName}" value="${escapeHtml(optText)}" data-opt-id="${escapeHtml(optId)}" ${isChecked ? 'checked' : ''} ${!isPending ? 'disabled' : ''}>
            <div class="option-content">
              <span class="option-num">${optIdx + 1}</span>
              <div class="option-text-wrap">
                ${isRec ? '<span class="question-rec-badge">Recommended</span>' : ''}
                <span class="option-text">${escapeHtml(cleanOpt)}</span>
              </div>
            </div>
          </label>
        `;
      }).join('');

      const otherOptionHtml = `
        <label class="question-option-item other-option">
          <input type="${inputType}" name="${inputName}" value="__OTHER__" data-opt-id="__OTHER__" ${!isPending ? 'disabled' : ''}>
          <div class="option-content">
            <span class="option-num">${(q.options || []).length + 1}</span>
            <span class="option-text">Other (직접 입력)</span>
          </div>
        </label>
        <div class="question-other-input-wrap hidden">
          <input type="text" class="question-other-input" placeholder="답변을 직접 입력하세요..." ${!isPending ? 'disabled' : ''}>
        </div>
      `;

      return `
        <div class="question-card ${isPending ? 'pending' : 'answered'}" data-turn-index="${turnIndex || ''}" data-question-text="${escapeHtml(q.question)}" data-multi="${isMulti ? 'true' : 'false'}">
          <div class="question-card-header">
            <div class="question-header-left">
              <span class="question-badge-icon">💬</span>
              <span class="question-title">${escapeHtml(q.question)}</span>
            </div>
            ${isPending ? '<span class="question-status-badge">선택 필요</span>' : '<span class="question-status-badge done">완료</span>'}
          </div>

          <div class="question-options-list">
            ${optionsHtml}
            ${otherOptionHtml}
          </div>

          ${isPending ? `
            <div class="question-card-footer">
              <button type="button" class="question-btn-skip">Skip</button>
              <button type="button" class="question-btn-submit">
                <span>Submit</span>
                <span class="btn-enter-icon">↵</span>
              </button>
            </div>
          ` : `
            <div class="question-answered-box">
              <span class="answered-check-icon">✓</span>
              <span class="answered-label">제출된 답변:</span>
              <span class="answered-value">${escapeHtml(qData.answer || '선택 완료')}</span>
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  function markQuestionCardAnswered(card, answerText) {
    if (!card) return;
    card.classList.remove('pending');
    card.classList.add('answered');
    const badge = card.querySelector('.question-status-badge');
    if (badge) {
      badge.className = 'question-status-badge done';
      badge.textContent = '완료';
    }
    card.querySelectorAll('input').forEach(i => { i.disabled = true; });
    const footer = card.querySelector('.question-card-footer');
    if (footer) {
      footer.outerHTML = `
        <div class="question-answered-box">
          <span class="answered-check-icon">✓</span>
          <span class="answered-label">제출된 답변:</span>
          <span class="answered-value">${escapeHtml(answerText || '선택 완료')}</span>
        </div>
      `;
    }
  }

  function buildAssistantTurnBody(turn, forceOpen = false) {
    let bodyHtml = '';

    // 중복 사고 과정 필터링 (동일 문장 반복 누적 방지)
    const uniqueThinkings = [];
    if (turn.thinkings && Array.isArray(turn.thinkings)) {
      turn.thinkings.forEach(t => {
        const trimmed = String(t).trim();
        if (trimmed && !uniqueThinkings.includes(trimmed)) {
          uniqueThinkings.push(trimmed);
        }
      });
    } else if (turn.thinking && typeof turn.thinking === 'string' && turn.thinking.trim()) {
      uniqueThinkings.push(turn.thinking.trim());
    }

    const hasThinkings = uniqueThinkings.length > 0;
    const toolList = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    const toolCount = toolList.length;
    const hasWorkProcess = hasThinkings || toolCount > 0;
    const content = (turn.content || turn.text || '').trim();

    const qData = turn.questionData || null;
    const hasPendingQuestion = !!(qData && qData.isPending);
    const hasAnsweredQuestion = !!(qData && qData.isAnswered);
    const hasQuestion = !!(qData && qData.questions && qData.questions.length > 0);

    const isGenerating = !content && !hasPendingQuestion;

    // Claude 앱 스타일 1줄 라이브 상태 텍스트
    let liveLabel = '● Thinking...';
    if (hasPendingQuestion) {
      liveLabel = '❓ 질문 선택 대기 중 (Waiting for choice)...';
    } else if (toolCount > 0) {
      const lastToolInfo = formatClaudeTool(toolList[toolList.length - 1]);
      liveLabel = `⚡ Running ${lastToolInfo.type}: ${lastToolInfo.target}...`;
    }

    if (hasWorkProcess) {
      // Claude 앱 스타일 완료 요약 라벨
      let workedLabel = '';
      if (hasPendingQuestion) {
        workedLabel = `Worked (${toolCount} tool${toolCount > 1 ? 's' : ''}) · 질문 대기 중`;
      } else if (toolCount > 0) {
        workedLabel = `Worked (${toolCount} tool${toolCount > 1 ? 's' : ''})`;
      } else {
        workedLabel = 'Thought';
      }

      let innerHtml = '';
      if (hasThinkings) {
        const fullThinking = uniqueThinkings.join('\n\n---\n\n');
        innerHtml += `
          <div class="claude-tree-item thinking">
            <div class="claude-item-head">
              <span class="claude-check-icon">💭</span>
              <span class="claude-item-title">사고 과정 (Extended Thinking)</span>
            </div>
            <div class="claude-item-body thinking-body">
              ${escapeHtml(fullThinking)}
            </div>
          </div>
        `;
      }

      if (toolCount > 0) {
        const renderClaudeToolItem = (tc, idx) => {
          const info = formatClaudeTool(tc);
          let cmdStr = '';
          if (tc.args && typeof tc.args === 'object') {
            if (tc.args.CommandLine) cmdStr = tc.args.CommandLine;
            else if (tc.args.AbsolutePath) cmdStr = tc.args.AbsolutePath;
            else if (tc.args.query) cmdStr = tc.args.query;
            else if (Object.keys(tc.args).length > 0) cmdStr = JSON.stringify(tc.args, null, 2);
          }
          return `
            <details class="claude-tree-item tool" ${idx === toolCount - 1 && !isGenerating && !hasPendingQuestion ? 'open' : ''}>
              <summary class="claude-item-head">
                <span class="claude-check-icon">✓</span>
                <span class="claude-tool-badge">${escapeHtml(info.type)}</span>
                <span class="claude-tool-target">${escapeHtml(info.target)}</span>
                <span class="claude-item-arrow">›</span>
              </summary>
              <div class="claude-item-body tool-body">
                ${cmdStr ? `<div class="claude-log-block"><div class="claude-log-title">Input</div><pre class="claude-log-pre">${escapeHtml(cmdStr)}</pre></div>` : ''}
                ${tc.output ? `<div class="claude-log-block"><div class="claude-log-title">Output</div><pre class="claude-log-pre output">${escapeHtml(tc.output)}</pre></div>` : ''}
              </div>
            </details>
          `;
        };

        const toolsHtml = toolList.map(renderClaudeToolItem).join('');
        innerHtml += `
          <div class="claude-tools-container">
            ${toolsHtml}
          </div>
        `;
      }

      const statusIconHtml = hasPendingQuestion
        ? '<span class="claude-pill-icon question-waiting-icon">❓</span>'
        : (isGenerating ? '<span class="claude-live-spinner"></span>' : '<span class="claude-pill-icon">⚙️</span>');
      const pillLabelText = hasPendingQuestion
        ? '질문 선택 대기 중 (Waiting for choice)'
        : (isGenerating ? liveLabel : workedLabel);

      bodyHtml += `
        <details class="claude-work-pill work-process-block ${isGenerating ? 'running' : ''} ${hasPendingQuestion ? 'waiting-question' : ''}" ${forceOpen || hasPendingQuestion ? 'open' : ''}>
          <summary class="claude-pill-summary work-process-summary">
            <div class="claude-pill-left">
              ${statusIconHtml}
              <span class="claude-pill-text work-process-label">${escapeHtml(pillLabelText)}</span>
            </div>
            <span class="claude-pill-arrow">›</span>
          </summary>
          <div class="claude-execution-tree work-process-body">
            ${innerHtml}
          </div>
        </details>
      `;
    } else if (isGenerating) {
      bodyHtml += `
        <div class="claude-live-pill live-thinking-chip live-thinking-card">
          <span class="claude-live-spinner thinking-spinner-mini"></span>
          <span class="claude-live-text thinking-chip-text">${escapeHtml(liveLabel)}</span>
        </div>
      `;
    }

    if (hasQuestion) {
      bodyHtml += renderQuestionCardHtml(qData, turn.index);
    }

    if (content) {
      bodyHtml += `<div class="turn-markdown">${renderMarkdown(content)}</div>`;
    } else if (!hasWorkProcess && !isGenerating && !hasQuestion) {
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

              // 마지막 턴만 내용/도구가 갱신된 경우 (경량 증분 업데이트로 전체 DOM 재생성 방지)
              const isOnlyLastTurnUpdated = lastRenderedTurn &&
                lastRenderedEl &&
                grouped.length === existingMessages.length &&
                latestServerTurn.index === lastRenderedTurn.index &&
                latestServerTurn.role === lastRenderedTurn.role &&
                isDifferentLastTurn;

              // 사용자가 이전 메시지를 로드한 상태(existingMessages.length > grouped.length)에서는
              // 단순 길이 비교로 전체 DOM을 날리지 않음!
              const hasLoadedEarlier = earliestLoadedTurnIndex !== null && existingMessages.length >= grouped.length;
              const needsFullRerender = !isOnlyLastTurnUpdated && (isDifferentLastTurn || (!hasLoadedEarlier && grouped.length !== existingMessages.length));

              if (isOnlyLastTurnUpdated) {
                // 경량 업데이트: 전체 대화를 날리지 않고 마지막 턴 엘리먼트만 갱신
                const prevScrollTop = chatContainer.scrollTop;
                const wasNearBottom = isAutoScroll && ((chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < 180);

                const newLastEl = createTurnElement(latestServerTurn);
                if (newLastEl) {
                  chatHistory.replaceChild(newLastEl, lastRenderedEl);
                  updateUserProcessingState();
                  if (wasNearBottom) {
                    scrollToBottom(true);
                  } else {
                    chatContainer.scrollTop = prevScrollTop;
                  }
                }
              } else if (needsFullRerender) {
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
            if (turn.questionData) {
              prevTurn.questionData = turn.questionData;
            }
            prevTurn.index = turn.index || prevTurn.index;
            prevTurn.timestamp = turn.timestamp || prevTurn.timestamp;
            updateAssistantTurnElement(lastMsg, prevTurn);
            scrollToBottom();
            if (prevTurn.content || prevTurn.questionData) {
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
    btnSend.disabled = (!hasText && !hasAttachments);
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

    // 만약 질문 선택 카드가 대기 중이면(Pending question) 사용자가 입력해야 하므로 busy가 아님!
    const pendingCard = chatHistory ? chatHistory.querySelector('.question-card.pending') : null;
    if (pendingCard) return false;

    const lastMsg = chatHistory ? chatHistory.querySelector('.message.assistant:last-child') : null;
    if (lastMsg && lastMsg.__turnData && lastMsg.__turnData.questionData && lastMsg.__turnData.questionData.isPending) {
      return false;
    }

    if (currentSession && (currentSession.isRunning || currentSession.status === 'CASCADE_RUN_STATUS_RUNNING')) return true;
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

  async function startNewConversation(text, requestedModel = null) {
    if (!text || !text.trim() || isSending) return;
    isSending = true;
    if (btnSend) btnSend.disabled = true;
    if (btnDrawerSend) btnDrawerSend.disabled = true;
    if (composerInput) composerInput.disabled = true;
    if (drawerComposerInput) drawerComposerInput.disabled = true;

    showToast('새 대화를 시작하는 중...');

    try {
      const modelObj = getSelectedModel();
      let tier = 'flash';
      const mId = (requestedModel || modelObj?.id || modelObj?.model || '').toLowerCase();
      if (mId.includes('flash-lite') || mId.includes('flash_lite') || mId.includes('lite')) {
        tier = 'flash_lite';
      } else if (mId.includes('pro') || mId.includes('opus') || mId.includes('sonnet') || mId.includes('claude')) {
        tier = 'pro';
      } else {
        tier = 'flash';
      }

      const res = await fetch('/api/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          model: tier
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '새 대화 생성 실패');
      }

      const newConv = data.result?.response?.newConversation;
      const cid = newConv?.conversationId;

      await fetchSessions();

      if (cid) {
        const newSessionObj = {
          cid: cid,
          name: `rc_${cid.slice(0, 8)}`,
          title: text.trim().slice(0, 40),
          status: 'running',
          type: 'daemon'
        };
        selectSession(newSessionObj);
        closeDrawer();
        showToast('새 대화가 시작되었습니다.');
      } else {
        closeDrawer();
        showToast('새 대화가 생성되었습니다.');
      }
    } catch (err) {
      console.error('Failed to start new conversation:', err);
      alert(`새 대화 시작 오류: ${err.message}`);
    } finally {
      isSending = false;
      if (composerInput) {
        composerInput.disabled = false;
        composerInput.value = '';
        composerInput.style.height = 'auto';
      }
      if (drawerComposerInput) {
        drawerComposerInput.disabled = false;
        drawerComposerInput.value = '';
        drawerComposerInput.style.height = 'auto';
      }
      updateSendButtonState();
      if (btnDrawerSend) btnDrawerSend.disabled = true;
      if (btnAttach) btnAttach.disabled = false;
    }
  }

  async function sendMessage() {
    if (isSending) return;
    const text = composerInput.value.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!text && !hasAttachments) return;

    // 만약 세션이 선택되지 않은 상태라면 자동으로 새 대화 시작!
    if (!currentSession) {
      if (text) {
        await startNewConversation(text);
      }
      return;
    }

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

      // Show live thinking indicator (Claude Style Live Pill)
      const typingEl = document.createElement('div');
      typingEl.className = 'message assistant typing-msg';
      typingEl.innerHTML = `
        <div class="bubble">
          <div class="claude-live-pill live-thinking-chip live-thinking-card">
            <span class="claude-live-spinner thinking-spinner-mini"></span>
            <span class="claude-live-text thinking-chip-text">● Thinking...</span>
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

    // 4. Question interactive Submit button
    const submitBtn = e.target.closest('.question-btn-submit');
    if (submitBtn) {
      e.stopPropagation();
      const card = submitBtn.closest('.question-card');
      if (!card) return;

      const isMulti = card.getAttribute('data-multi') === 'true';
      const inputs = Array.from(card.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked'));

      if (inputs.length === 0) {
        alert('선택지를 선택하거나 답변을 직접 입력해주세요.');
        return;
      }

      const selectedTexts = [];
      const selectedOptionIds = [];
      let writeInResponse = '';

      for (const inp of inputs) {
        if (inp.value === '__OTHER__') {
          const otherInput = card.querySelector('.question-other-input');
          const customText = otherInput?.value.trim();
          if (!customText) {
            alert('직접 입력 옵션을 선택하셨습니다. 답변 내용을 입력해주세요.');
            otherInput?.focus();
            return;
          }
          selectedTexts.push(customText);
          writeInResponse = customText;
        } else {
          selectedTexts.push(inp.value);
          const optId = inp.getAttribute('data-opt-id') || inp.value;
          selectedOptionIds.push(optId);
        }
      }

      const answerText = isMulti ? `A1: ${selectedTexts.join(', ')}` : `A1: ${selectedTexts[0]}`;
      const qText = card.getAttribute('data-question-text') || '';
      const turnIndex = Number(card.getAttribute('data-turn-index')) || null;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>전송 중...</span>';

      const isDaemon = currentSession && (currentSession.cid || (currentSession.name && (currentSession.name.startsWith('rc_') || currentSession.name.startsWith('agy_'))));
      const targetCid = currentSession?.cid || (currentSession?.name ? currentSession.name.replace(/^(rc_|agy_)/, '') : '');

      if (isDaemon && targetCid) {
        try {
          const res = await fetch('/api/respond-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cid: targetCid,
              session: currentSession.name,
              stepIndex: turnIndex,
              responses: [
                {
                  question: qText,
                  selectedOptionIds: selectedOptionIds,
                  writeInResponse: writeInResponse,
                  skipped: false
                }
              ],
              cancelled: false
            })
          });
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
          showToast('답변이 성공적으로 전송되었습니다.');
          markQuestionCardAnswered(card, selectedTexts.join(', '));
        } catch (err) {
          console.error('Failed to submit question via RPC:', err);
          alert(`전송 중 오류 발생: ${err.message}`);
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit</span><span class="btn-enter-icon">↵</span>';
        }
      } else {
        try {
          await executeDirectSend(answerText);
          showToast('답변이 전송되었습니다.');
          markQuestionCardAnswered(card, answerText);
        } catch (err) {
          console.error('Failed to send question answer:', err);
          alert(`전송 중 오류 발생: ${err.message}`);
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit</span><span class="btn-enter-icon">↵</span>';
        }
      }
      return;
    }

    // 5. Question interactive Skip button
    const skipBtn = e.target.closest('.question-btn-skip');
    if (skipBtn) {
      e.stopPropagation();
      const card = skipBtn.closest('.question-card');
      if (!card) return;

      skipBtn.disabled = true;
      skipBtn.innerText = '건너뛰는 중...';

      const isDaemon = currentSession && (currentSession.cid || (currentSession.name && (currentSession.name.startsWith('rc_') || currentSession.name.startsWith('agy_'))));
      const targetCid = currentSession?.cid || (currentSession?.name ? currentSession.name.replace(/^(rc_|agy_)/, '') : '');
      const qText = card.getAttribute('data-question-text') || '';
      const turnIndex = Number(card.getAttribute('data-turn-index')) || null;

      if (isDaemon && targetCid) {
        try {
          const res = await fetch('/api/respond-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cid: targetCid,
              session: currentSession.name,
              stepIndex: turnIndex,
              responses: [
                {
                  question: qText,
                  selectedOptionIds: [],
                  writeInResponse: '',
                  skipped: true
                }
              ],
              cancelled: false
            })
          });
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
          showToast('질문을 건너뛰었습니다.');
          markQuestionCardAnswered(card, '건너뜀 (Skip)');
        } catch (err) {
          console.error('Failed to skip question via RPC:', err);
          alert(`Skip 처리 중 오류 발생: ${err.message}`);
          skipBtn.disabled = false;
          skipBtn.innerText = 'Skip';
        }
      } else {
        try {
          await executeDirectSend('A1: Skip');
          showToast('질문을 건너뛰었습니다.');
          markQuestionCardAnswered(card, 'Skip');
        } catch (err) {
          console.error('Failed to skip question:', err);
          skipBtn.disabled = false;
          skipBtn.innerText = 'Skip';
        }
      }
      return;
    }
  });

  // Handle radio / checkbox changes for question interactive cards
  chatHistory.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.matches('.question-option-item input')) return;
    const card = input.closest('.question-card');
    if (!card) return;

    const otherInputWrap = card.querySelector('.question-other-input-wrap');
    const otherRadio = card.querySelector('input[value="__OTHER__"]');
    if (otherInputWrap && otherRadio) {
      if (otherRadio.checked) {
        otherInputWrap.classList.remove('hidden');
        const textInp = otherInputWrap.querySelector('.question-other-input');
        if (textInp) textInp.focus();
      } else {
        otherInputWrap.classList.add('hidden');
      }
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
    let displayText = '';
    if (current.id.startsWith('gemini-3.8-flash')) {
      displayText = `Gemini 3.8 Flash ${effortLabel}`;
    } else if (current.displayName.includes('Claude') || current.displayName.includes('GPT')) {
      displayText = `${current.displayName.replace(/ \(.*?\)/, '')} (${effortLabel})`;
    } else {
      displayText = current.chipLabel || `${current.displayName} ${current.subLabel || ''}`.trim();
    }
    modelPickerName.innerText = displayText;
    if (drawerModelName) {
      drawerModelName.innerText = displayText;
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

  function initDrawerComposer() {
    if (drawerComposerInput && btnDrawerSend) {
      drawerComposerInput.addEventListener('input', () => {
        drawerComposerInput.style.height = 'auto';
        drawerComposerInput.style.height = Math.min(drawerComposerInput.scrollHeight, 100) + 'px';
        btnDrawerSend.disabled = !drawerComposerInput.value.trim() || isSending;
      });

      drawerComposerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          const text = drawerComposerInput.value.trim();
          if (text && !isSending) {
            startNewConversation(text);
          }
        }
      });

      btnDrawerSend.addEventListener('click', () => {
        const text = drawerComposerInput.value.trim();
        if (text && !isSending) {
          startNewConversation(text);
        }
      });
    }

    if (btnDrawerNew && drawerComposerInput) {
      btnDrawerNew.addEventListener('click', (e) => {
        e.stopPropagation();
        drawerComposerInput.focus();
      });
    }

    if (btnDrawerModelPicker) {
      btnDrawerModelPicker.addEventListener('click', (e) => {
        e.stopPropagation();
        openModelPicker();
      });
    }
  }

  // --- Initial Load ---
  initModelPicker();
  initVoiceRecognition();
  initSessionActionMenu();
  initDrawerComposer();

  const currentSessionTitleEl = document.getElementById('current-session-title');
  if (currentSessionTitleEl) {
    currentSessionTitleEl.addEventListener('click', () => {
      if (!currentSession) return;
      renameSession(currentSession, null);
    });
    currentSessionTitleEl.style.cursor = 'pointer';
    currentSessionTitleEl.title = '클릭하여 세션 이름 변경';
  }

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
