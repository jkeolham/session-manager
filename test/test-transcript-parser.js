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

// 3. Test user-turn aligned slicing when tool steps exceed limit
const singlePromptManySteps = [
  JSON.stringify({ step_index: 1, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "작업을 시작해줘." })
];
for (let i = 2; i <= 60; i++) {
  singlePromptManySteps.push(JSON.stringify({
    step_index: i,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    content: `단계 ${i} 완료`,
    tool_calls: [{ tool_name: "run_command", args: { CommandLine: `step ${i}` }, toolSummary: `Step ${i}` }]
  }));
}
const longResult = parseTranscriptString(singlePromptManySteps.join('\n'), 20);
assert.strictEqual(longResult.totalCount, 60, 'Total turns should be 60');
assert.strictEqual(longResult.turns[0].role, 'user', 'First turn must remain user prompt even if tool steps exceed limit');
assert.strictEqual(longResult.turns[0].content, '작업을 시작해줘.');
assert.strictEqual(longResult.turns.length, 60, 'Should preserve full exchange with user turn');
assert.strictEqual(longResult.hasEarlier, false, 'hasEarlier should be false since it started from index 0');

// 4. Test multi-exchange user turn alignment
const multiExchange = [
  JSON.stringify({ step_index: 1, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "질문 1" }),
  JSON.stringify({ step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "답변 1" }),
  JSON.stringify({ step_index: 3, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "질문 2" }),
  JSON.stringify({ step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "답변 2 - step 1" }),
  JSON.stringify({ step_index: 5, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "답변 2 - step 2" }),
  JSON.stringify({ step_index: 6, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "답변 2 - step 3" })
];
// Total 6 turns. Limit = 3. candidateStart = 6 - 3 = 3 (index 3 is "답변 2 - step 1").
// Nearest user turn <= 3 is index 2 ("질문 2").
// Should slice from index 2, keeping turns [2, 3, 4, 5], so turns[0] is "질문 2".
const multiResult = parseTranscriptString(multiExchange.join('\n'), 3);
assert.strictEqual(multiResult.totalCount, 6);
assert.strictEqual(multiResult.turns[0].role, 'user');
assert.strictEqual(multiResult.turns[0].content, '질문 2');
assert.strictEqual(multiResult.turns.length, 4);
assert.strictEqual(multiResult.hasEarlier, true);
assert.strictEqual(multiResult.earliestIndex, 3);
assert.strictEqual(multiResult.latestIndex, 6);

// 5. Test pagination with beforeIndex
const earlierResult = parseTranscriptString(multiExchange.join('\n'), 3, multiResult.earliestIndex);
assert.strictEqual(earlierResult.totalCount, 6);
assert.strictEqual(earlierResult.turns.length, 2, 'Should return earlier 2 turns');
assert.strictEqual(earlierResult.turns[0].content, '질문 1');
assert.strictEqual(earlierResult.turns[1].content, '답변 1');
assert.strictEqual(earlierResult.hasEarlier, false, 'No earlier turns left');
assert.strictEqual(earlierResult.earliestIndex, 1);
assert.strictEqual(earlierResult.latestIndex, 2);

console.log('✅ test-transcript-parser passed!');
