const assert = require('assert');
const { getPanelKey, resolveTranscriptPath } = require('../chat-panel');

assert.strictEqual(getPanelKey({ cid: 'cc0d3739-test' }), 'rc_cc0d3739');
assert.strictEqual(getPanelKey({ name: 'agy_test_sess' }), 'agy_test_sess');

const resolvedDirect = resolveTranscriptPath('245a2aca-cc53-4efe-9cf1-234e9c0e41bc');
assert.ok(resolvedDirect && resolvedDirect.includes('245a2aca'), 'Should resolve direct cid transcript path');

const resolvedPrefix = resolveTranscriptPath(null, 'rc_245a2aca');
assert.ok(resolvedPrefix && resolvedPrefix.includes('245a2aca'), 'Should resolve prefix transcript path from tmux session name');

console.log('✅ test-chat-panel passed!');
