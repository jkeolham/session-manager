const assert = require('assert');
const {
  formatDuration,
  formatToolStep,
  groupConsecutiveTurns,
  renderTurn
} = require('../media/chat');

console.log('Testing Antigravity states (Active Working vs Completed Folded)...');

// 1. Test formatDuration
assert.strictEqual(formatDuration(14), '14s');
assert.strictEqual(formatDuration(54), '54s');
assert.strictEqual(formatDuration(63), '1m 3s');
assert.strictEqual(formatDuration(180), '3m');
assert.strictEqual(formatDuration(240), '4m');

// 2. Test formatToolStep for view_file
const viewStep = formatToolStep({
  name: 'view_file',
  args: {
    AbsolutePath: '/home/ttolmany/.local/share/session-manager/chat-panel.js',
    StartLine: 1,
    EndLine: 120
  }
});
assert.strictEqual(viewStep.type, 'analyzed');
assert.strictEqual(viewStep.ext, 'js');
assert.strictEqual(viewStep.filename, 'chat-panel.js');
assert.strictEqual(viewStep.lineRange, '#L1-120');

// 3. Test formatToolStep for run_command
const cmdStep = formatToolStep({
  name: 'run_command',
  toolSummary: 'List tmux sessions',
  args: { CommandLine: 'tmux list-sessions' }
});
assert.strictEqual(cmdStep.type, 'tool_action');
assert.strictEqual(cmdStep.label, 'List tmux sessions');

// 4. Test STATE A: Completed turn (답변 완료 시 - Image 3)
// All tool runs and thoughts must fold into a SINGLE "Worked for 3m" block
const completedTurns = [
  { role: 'user', content: '진행해' },
  { role: 'assistant', index: 1, thinking: '분석 중...', toolCalls: [{ name: 'run_command', toolSummary: 'List tmux sessions' }] },
  { role: 'assistant', index: 2, toolCalls: [{ name: 'view_file', args: { AbsolutePath: '/test/chat-panel.js', StartLine: 1, EndLine: 120 } }] },
  { role: 'assistant', index: 3, thinking: '쿼리 실행 중...', toolCalls: [{ name: 'run_command', toolSummary: 'Run sqlite query' }] },
  { role: 'assistant', index: 4, thinking: '정리 중...', content: '사운드트랙 전 트랙의 메타데이터 전면 정규화가 완료되었습니다.' }
];

const completedGrouped = groupConsecutiveTurns(completedTurns);
assert.strictEqual(completedGrouped.length, 2);
assert.strictEqual(completedGrouped[0].role, 'user');
assert.strictEqual(completedGrouped[1].role, 'assistant');

// Must have exactly 2 items: 1 worked_group (folded) and 1 content
const compItems = completedGrouped[1].items;
assert.strictEqual(compItems.length, 2, 'Completed turn must fold all steps into worked_group followed by content');
assert.strictEqual(compItems[0].type, 'worked_group');
assert(compItems[0].steps.length >= 4, 'All intermediate steps must be nested inside worked_group');
assert.strictEqual(compItems[1].type, 'content');
assert.strictEqual(compItems[1].content, '사운드트랙 전 트랙의 메타데이터 전면 정규화가 완료되었습니다.');

const compHtml = renderTurn(completedGrouped[1]);
assert(compHtml.includes('Worked for'), 'Completed HTML must have Worked for');
assert(compHtml.includes('worked-group'), 'Completed HTML must have worked-group details');
assert(compHtml.includes('Analyzed <span class="file-ext-badge ext-js">JS</span>'), 'Inside worked-group, Analyzed badge must be present');
assert(compHtml.includes('사운드트랙 전 트랙의 메타데이터 전면 정규화가 완료되었습니다.'), 'Completed HTML must render answer');

// 5. Test STATE B: Active / In progress turn (동작 중 - Image 1)
// Detailed steps must be visible in real-time, ending with Working indicator
const activeTurns = [
  { role: 'user', content: 'ide 세션매니저와 싱크가 맞지않네' },
  { role: 'assistant', index: 1, toolCalls: [{ name: 'view_file', args: { AbsolutePath: '/test/chat-panel.js', StartLine: 1, EndLine: 120 } }] },
  { role: 'assistant', index: 2, toolCalls: [{ name: 'run_command', toolSummary: 'List tmux sessions' }] },
  { role: 'assistant', index: 3, thinking: '확인 중...' }
];

const activeGrouped = groupConsecutiveTurns(activeTurns);
assert.strictEqual(activeGrouped.length, 2);
assert.strictEqual(activeGrouped[1].isWorking, true, 'Last turn without content must be isWorking = true');

const actItems = activeGrouped[1].items;
assert.strictEqual(actItems[0].type, 'analyzed');
assert.strictEqual(actItems[1].type, 'tool_action');
assert.strictEqual(actItems[2].type, 'thought');
assert.strictEqual(actItems[3].type, 'working_indicator');

const actHtml = renderTurn(activeGrouped[1]);
assert(actHtml.includes('Working'), 'Active HTML must have Working indicator');
assert(actHtml.includes('Analyzed <span class="file-ext-badge ext-js">JS</span>'), 'Active HTML must render analyzed line directly');
assert(!actHtml.includes('Worked for'), 'Active HTML must NOT be folded into Worked for');

// 6. Test backward compatibility for single un-grouped turn
const singleTurnHtml = renderTurn({
  role: 'assistant',
  thinking: '단일 생각...',
  toolCalls: [{ name: 'run_command', label: 'Run echo' }],
  content: '단일 답변'
});
assert(singleTurnHtml.includes('Worked for'), 'Single completed turn must fold into Worked for');
assert(singleTurnHtml.includes('단일 답변'), 'Single turn should render content');

console.log('✅ All Antigravity Active & Completed state tests passed!');
