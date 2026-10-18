// Terminal stream handler for the embedded console tab
(function() {
  const terminalContainer = document.getElementById('terminal-container');
  const terminalOutput = document.getElementById('terminal-output');
  const btnScrollBottom = document.getElementById('btn-term-scroll-bottom');

  if (!terminalContainer || !terminalOutput) return;

  let isAutoScroll = true;

  // Track scrolling inside terminal-output pre element
  terminalOutput.addEventListener('scroll', () => {
    const distFromBottom = terminalOutput.scrollHeight - terminalOutput.scrollTop - terminalOutput.clientHeight;
    isAutoScroll = distFromBottom < 40;
    if (btnScrollBottom) {
      btnScrollBottom.style.display = isAutoScroll ? 'none' : 'block';
    }
  });

  if (btnScrollBottom) {
    btnScrollBottom.addEventListener('click', () => {
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
      isAutoScroll = true;
      btnScrollBottom.style.display = 'none';
    });
  }

  
  // Sync tmux terminal width on resize or activation
  function syncCols() {
    const viewTerm = document.getElementById('view-term');
    if (!viewTerm || !viewTerm.classList.contains('active')) return;
    const cols = Math.max(80, Math.floor((terminalContainer.clientWidth - 36) / 7.5));
    if (window.vscode) {
      window.vscode.postMessage({ command: 'termResize', cols });
    }
  }

  window.addEventListener('resize', syncCols);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'termInit' || msg.type === 'termOutput') {
      if (msg.data !== undefined) {
        terminalOutput.textContent = msg.data;
        if (isAutoScroll || msg.type === 'termInit') {
          terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }
      }
    }
  });

  // Windows drag-to-copy
  terminalOutput.addEventListener('mouseup', () => {
    const selection = window.getSelection().toString();
    if (selection && selection.length > 0) {
      navigator.clipboard.writeText(selection);
    }
  });

  // Windows right-click paste
  terminalOutput.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && window.vscode) {
        window.vscode.postMessage({ command: 'termData', data: clipText });
      }
    } catch (err) {}
  });

  // Key capture when terminal view is focused
  window.addEventListener('keydown', (e) => {
    const viewTerm = document.getElementById('view-term');
    if (!viewTerm || !viewTerm.classList.contains('active')) return;
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'termData', data: e.key });
      }
    } else if (e.key === 'Enter') {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'termData', data: '\r' });
      }
    } else if (e.key === 'Backspace') {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'termData', data: '\x7f' });
      }
    }
  });
})();
