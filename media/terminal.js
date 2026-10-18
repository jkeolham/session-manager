// Terminal stream handler for the embedded console tab
(function() {
  const terminalContainer = document.getElementById('terminal-container');
  const terminalOutput = document.getElementById('terminal-output');
  const btnScrollBottom = document.getElementById('btn-term-scroll-bottom');
  const termCmdInput = document.getElementById('term-cmd-input');
  const btnTermSend = document.getElementById('btn-term-send');

  if (!terminalContainer || !terminalOutput) return;

  let isAutoScroll = true;
  let cmdHistory = [];
  let historyIdx = -1;

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
      if (termCmdInput) termCmdInput.focus();
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

  // Send command from dedicated input bar
  function sendTermCmd() {
    if (!termCmdInput) return;
    const cmd = termCmdInput.value;
    if (cmd.trim() === '') return;

    if (window.vscode) {
      window.vscode.postMessage({ command: 'termCommand', text: cmd });
    }

    cmdHistory.unshift(cmd);
    if (cmdHistory.length > 50) cmdHistory.pop();
    historyIdx = -1;

    termCmdInput.value = '';
    isAutoScroll = true;
  }

  if (btnTermSend) {
    btnTermSend.addEventListener('click', sendTermCmd);
  }

  if (termCmdInput) {
    termCmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendTermCmd();
      } else if (e.key === 'ArrowUp') {
        if (historyIdx < cmdHistory.length - 1) {
          e.preventDefault();
          historyIdx++;
          termCmdInput.value = cmdHistory[historyIdx] || '';
        }
      } else if (e.key === 'ArrowDown') {
        if (historyIdx > 0) {
          e.preventDefault();
          historyIdx--;
          termCmdInput.value = cmdHistory[historyIdx] || '';
        } else if (historyIdx === 0) {
          e.preventDefault();
          historyIdx = -1;
          termCmdInput.value = '';
        }
      }
    });
  }

  // Direct keystroke capture when terminal view is active (when input bar is not focused)
  window.addEventListener('keydown', (e) => {
    const viewTerm = document.getElementById('view-term');
    if (!viewTerm || !viewTerm.classList.contains('active')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.ctrlKey) {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x03' });
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x04' });
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x0c' });
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\t' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\r' });
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x7f' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x1b[A' });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x1b[B' });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x1b[C' });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (window.vscode) window.vscode.postMessage({ command: 'termData', data: '\x1b[D' });
    } else if (e.key.length === 1 && !e.metaKey && !e.altKey) {
      if (window.vscode) {
        window.vscode.postMessage({ command: 'termData', data: e.key });
      }
    }
  });
})();
