const assert = require('assert');
const { groupConsecutiveTurns, renderTurn, formatDuration } = require('../media/chat');

console.log('Testing step traces & Antigravity layout...');

// 1. Test formatDuration
assert.strictEqual(formatDuration(14), '14s');
assert.strictEqual(formatDuration(54), '54s');
assert.strictEqual(formatDuration(65), '1m 5s');
assert.strictEqual(formatDuration(120), '2m');

// 2. Test turn grouping with fishing session pattern
const rawTurns = [
  { role: 'user', content: '출조 브리핑 웹앱 만들어줘' },
  { role: 'assistant', index: 1, thinking: '분석 중...', toolCalls: [{ name: 'run_command', label: 'Run ls' }] },
  { role: 'assistant', index: 2, toolCalls: [{ name: 'run_command', label: 'Run grep' }] },
  { role: 'assistant', index: 3, toolCalls: [{ name: 'view_file', label: 'View briefing.py' }] },
  { role: 'assistant', index: 4, content: '출조 브리핑 스크립트 실행 결과를 확인하고 있습니다.' },
  { role: 'assistant', index: 5, toolCalls: [{ name: 'run_command', label: 'Run briefing.py' }] },
  { role: 'assistant', index: 6, thinking: '네, 가능합니다...'.repeat(50), content: '네, 충분히 가능하며 매우 유용한 웹앱이 될 수 있습니다!' }
];

const grouped = groupConsecutiveTurns(rawTurns);
assert.strictEqual(grouped.length, 2, 'Should group into 1 user turn and 1 assistant turn');
assert.strictEqual(grouped[0].role, 'user');
assert.strictEqual(grouped[1].role, 'assistant');

const items = grouped[1].items;
assert.strictEqual(items.length, 5, 'Should have 5 items in sequence');

// Item 0: Worked group for first 3 tools
assert.strictEqual(items[0].type, 'worked');
assert.strictEqual(items[0].actions.length, 3);
assert.strictEqual(items[0].initialThought, '분석 중...');
assert(items[0].duration.includes('s'));

// Item 1: Interim status message
assert.strictEqual(items[1].type, 'interim');
assert.strictEqual(items[1].content, '출조 브리핑 스크립트 실행 결과를 확인하고 있습니다.');

// Item 2: Single tool call after interim message
assert.strictEqual(items[2].type, 'single_tool');
assert.strictEqual(items[2].tool.label, 'Run briefing.py');

// Item 3: Thought block before final answer
assert.strictEqual(items[3].type, 'thought');
assert(items[3].duration.includes('s'));

// Item 4: Final content
assert.strictEqual(items[4].type, 'content');
assert.strictEqual(items[4].content, '네, 충분히 가능하며 매우 유용한 웹앱이 될 수 있습니다!');

// 3. Test HTML rendering in Node environment
const html = renderTurn(grouped[1]);
assert(html.includes('Worked for'), 'HTML should contain Worked for summary');
assert(html.includes('worked-group'), 'HTML should have worked-group details class');
assert(html.includes('assistant-interim-text'), 'HTML should have interim text class');
assert(html.includes('Run briefing.py finished'), 'HTML should have single tool finished summary');
assert(html.includes('Thought for'), 'HTML should have Thought for summary');
assert(html.includes('네, 충분히 가능하며 매우 유용한 웹앱이 될 수 있습니다!'), 'HTML should have final answer text');

// 4. Test backward compatibility for single un-grouped turn
const singleTurnHtml = renderTurn({
  role: 'assistant',
  thinking: '단일 생각...',
  toolCalls: [{ name: 'run_command', label: 'Run echo' }],
  content: '단일 답변'
});
assert(singleTurnHtml.includes('Thought for'), 'Single turn should render Thought for');
assert(singleTurnHtml.includes('Run echo finished'), 'Single turn should render tool finished');
assert(singleTurnHtml.includes('단일 답변'), 'Single turn should render content');

console.log('✅ All step traces and Antigravity layout tests passed!');
