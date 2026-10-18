const { execSync } = require('child_process');
const assert = require('assert');

execSync('tmux new-session -d -s test_term_bridge bash');
execSync('tmux send-keys -t test_term_bridge -l "echo bridge_ok" && tmux send-keys -t test_term_bridge Enter');
const out = execSync('tmux capture-pane -p -t test_term_bridge').toString();
assert(out.includes('bridge_ok'), 'Should capture pane output');
execSync('tmux kill-session -t test_term_bridge 2>/dev/null || true');

console.log('✅ test-terminal-bridge passed!');
