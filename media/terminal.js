// Terminal stream handler for both embedded console tab and in-window native terminal tab
(function() {
  const terminalContainer = document.getElementById('terminal-container');
  const terminalOutput = document.getElementById('terminal-output');
  const btnScrollBottom = document.getElementById('btn-term-scroll-bottom');
  const termCmdInput = document.getElementById('term-cmd-input');
  const btnTermSend = document.getElementById('btn-term-send');

  const nativeTerminalContainer = document.getElementById('native-terminal-container');
  const nativeTerminalOutput = document.getElementById('native-terminal-output');
  const btnNativeScrollBottom = document.getElementById('btn-native-term-scroll-bottom');
  const nativeTermCmdInput = document.getElementById('native-term-cmd-input');
  const btnNativeTermSend = document.getElementById('btn-native-term-send');

  let isAutoScroll = true;
  let isNativeAutoScroll = true;
  let cmdHistory = [];
  let historyIdx = -1;

  // Track scrolling inside terminal outputs
  if (terminalOutput) {
    terminalOutput.addEventListener('scroll', () => {
      const distFromBottom = terminalOutput.scrollHeight - terminalOutput.scrollTop - terminalOutput.clientHeight;
      isAutoScroll = distFromBottom < 40;
      if (btnScrollBottom) {
        btnScrollBottom.style.display = isAutoScroll ? 'none' : 'block';
      }
    });
  }

  if (nativeTerminalOutput) {
    nativeTerminalOutput.addEventListener('scroll', () => {
      const distFromBottom = nativeTerminalOutput.scrollHeight - nativeTerminalOutput.scrollTop - nativeTerminalOutput.clientHeight;
      isNativeAutoScroll = distFromBottom < 40;
      if (btnNativeScrollBottom) {
        btnNativeScrollBottom.style.display = isNativeAutoScroll ? 'none' : 'block';
      }
    });
  }

  if (btnScrollBottom) {
    btnScrollBottom.addEventListener('click', () => {
      if (terminalOutput) terminalOutput.scrollTop = terminalOutput.scrollHeight;
      isAutoScroll = true;
      btnScrollBottom.style.display = 'none';
      if (termCmdInput) termCmdInput.focus();
    });
  }

  if (btnNativeScrollBottom) {
    btnNativeScrollBottom.addEventListener('click', () => {
      if (nativeTerminalOutput) nativeTerminalOutput.scrollTop = nativeTerminalOutput.scrollHeight;
      isNativeAutoScroll = true;
      btnNativeScrollBottom.style.display = 'none';
      if (nativeTermCmdInput) nativeTermCmdInput.focus();
    });
  }

  // Sync tmux terminal width on resize
  function syncCols() {
    const viewTerm = document.getElementById('view-term');
    const viewNativeTerm = document.getElementById('view-native-term');
    const isTermActive = viewTerm && viewTerm.classList.contains('active');
    const isNativeActive = viewNativeTerm && viewNativeTerm.classList.contains('active');
    if (!isTermActive && !isNativeActive) return;

    const container = isNativeActive ? nativeTerminalContainer : terminalContainer;
    if (container && window.vscode) {
      const cols = Math.max(80, Math.floor((container.clientWidth - 36) / 7.5));
      window.vscode.postMessage({ command: 'termResize', cols });
    }
  }

  window.addEventListener('resize', syncCols);

  // Receive stream: ONLY update DOM when content changed to prevent layout reflow freezes
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'termInit' || msg.type === 'termOutput') {
      if (msg.data !== undefined) {
        if (terminalOutput && terminalOutput.textContent !== msg.data) {
          terminalOutput.textContent = msg.data;
          if (isAutoScroll || msg.type === 'termInit') {
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
          }
        }
        if (nativeTerminalOutput && nativeTerminalOutput.textContent !== msg.data) {
          nativeTerminalOutput.textContent = msg.data;
          if (isNativeAutoScroll || msg.type === 'termInit') {
            nativeTerminalOutput.scrollTop = nativeTerminalOutput.scrollHeight;
          }
        }
      }
    }
  });

  // Windows drag-to-copy & right-click paste
  const setupCopyPaste = (elem) => {
    if (!elem) return;
    elem.addEventListener('mouseup', () => {
      const selection = window.getSelection().toString();
      if (selection && selection.length > 0) {
        navigator.clipboard.writeText(selection);
      }
    });

    elem.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && window.vscode) {
          window.vscode.postMessage({ command: 'termData', data: clipText });
        }
      } catch (err) {}
    });
  };

  setupCopyPaste(terminalOutput);
  setupCopyPaste(nativeTerminalOutput);

  // Send command from input bar
  function sendTermCmd(inputElem) {
    if (!inputElem) return;
    const cmd = inputElem.value;
    if (cmd.trim() === '') return;

    if (window.vscode) {
      window.vscode.postMessage({ command: 'termCommand', text: cmd });
    }

    cmdHistory.unshift(cmd);
    if (cmdHistory.length > 50) cmdHistory.pop();
    historyIdx = -1;

    inputElem.value = '';
    isAutoScroll = true;
    isNativeAutoScroll = true;
  }

  const setupInputHandlers = (inputElem, btnElem) => {
    if (btnElem && inputElem) {
      btnElem.addEventListener('click', () => sendTermCmd(inputElem));
    }
    if (inputElem) {
      inputElem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendTermCmd(inputElem);
        } else if (e.key === 'ArrowUp') {
          if (historyIdx < cmdHistory.length - 1) {
            e.preventDefault();
            historyIdx++;
            inputElem.value = cmdHistory[historyIdx] || '';
          }
        } else if (e.key === 'ArrowDown') {
          if (historyIdx > 0) {
            e.preventDefault();
            historyIdx--;
            inputElem.value = cmdHistory[historyIdx] || '';
          } else if (historyIdx === 0) {
            e.preventDefault();
            historyIdx = -1;
            inputElem.value = '';
          }
        }
      });
    }
  };

  setupInputHandlers(termCmdInput, btnTermSend);
  setupInputHandlers(nativeTermCmdInput, btnNativeTermSend);

  // Direct keystroke capture when either terminal view is active
  window.addEventListener('keydown', (e) => {
    const viewTerm = document.getElementById('view-term');
    const viewNativeTerm = document.getElementById('view-native-term');
    const isTermActive = viewTerm && viewTerm.classList.contains('active');
    const isNativeActive = viewNativeTerm && viewNativeTerm.classList.contains('active');
    if (!isTermActive && !isNativeActive) return;
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
