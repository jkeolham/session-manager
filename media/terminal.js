// Terminal stream handler for the embedded console tab
(function() {
  const terminalContainer = document.getElementById('terminal-container');
  const terminalOutput = document.getElementById('terminal-output');

  if (!terminalContainer || !terminalOutput) return;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'termInit' || msg.type === 'termOutput') {
      if (msg.data) {
        terminalOutput.textContent = msg.data;
        terminalContainer.scrollTop = terminalContainer.scrollHeight;
      }
    }
  });

  // Windows drag-to-copy
  terminalContainer.addEventListener('mouseup', () => {
    const selection = window.getSelection().toString();
    if (selection && selection.length > 0) {
      navigator.clipboard.writeText(selection);
    }
  });

  // Windows right-click paste
  terminalContainer.addEventListener('contextmenu', async (e) => {
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
