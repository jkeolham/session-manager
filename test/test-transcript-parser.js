const assert = require('assert');
const { parseTranscriptString } = require('../transcript-parser');

const sampleJsonl = [
  JSON.stringify({ step_index: 1, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "안녕하세요! 테스트 질문입니다." }),
  JSON.stringify({ step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "안녕하세요! 답변입니다.\n```python\nprint('hello')\n```", tool_calls: [{ tool_name: "run_command", args: { CommandLine: "echo test" } }], thinking: "생각 중..." }),
  "{ corrupted json line"
].join('\n');

const result = parseTranscriptString(sampleJsonl, 10);
assert.strictEqual(result.turns.length, 2, 'Should parse exactly 2 valid turns');
assert.strictEqual(result.turns[0].role, 'user');
assert.strictEqual(result.turns[0].content, '안녕하세요! 테스트 질문입니다.');
assert.strictEqual(result.turns[1].role, 'assistant');
assert.strictEqual(result.turns[1].toolCalls.length, 1);
assert.strictEqual(result.turns[1].toolCalls[0].name, 'run_command');
assert.strictEqual(result.turns[1].thinking, '생각 중...');

console.log('✅ test-transcript-parser passed!');
