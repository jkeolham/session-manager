const assert = require('assert');
const { parseTranscriptString, cleanUserMessage } = require('../transcript-parser');

// 1. Test cleanUserMessage with raw XML envelopes
const dirty = `<USER_REQUEST>
진행 현황을 알려줘.
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-18T19:34:53+09:00.
</ADDITIONAL_METADATA>`;
assert.strictEqual(cleanUserMessage(dirty), '진행 현황을 알려줘.');
assert.strictEqual(cleanUserMessage('단순 텍스트'), '단순 텍스트');

// 2. Test JSONL parsing
const sampleJsonl = [
  JSON.stringify({ step_index: 1, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "안녕하세요! 테스트 질문입니다." }),
  JSON.stringify({
    step_index: 2,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    content: "안녕하세요! 답변입니다.\n```python\nprint('hello')\n```",
    tool_calls: [{ tool_name: "run_command", args: { CommandLine: "echo test" }, toolSummary: "Run echo test" }],
    thinking: "생각 중..."
  }),
  JSON.stringify({
    step_index: 3,
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    status: "DONE",
    content: dirty
  }),
  "{ corrupted json line"
].join('\n');

const result = parseTranscriptString(sampleJsonl, 10);
assert.strictEqual(result.turns.length, 3, 'Should parse exactly 3 valid turns');
assert.strictEqual(result.turns[0].role, 'user');
assert.strictEqual(result.turns[0].content, '안녕하세요! 테스트 질문입니다.');
assert.strictEqual(result.turns[1].role, 'assistant');
assert.strictEqual(result.turns[1].toolCalls.length, 1);
assert.strictEqual(result.turns[1].toolCalls[0].label, 'Run echo test');
assert.strictEqual(result.turns[1].thinking, '생각 중...');
assert.strictEqual(result.turns[2].role, 'user');
assert.strictEqual(result.turns[2].content, '진행 현황을 알려줘.');

console.log('✅ test-transcript-parser passed!');
