const assert = require('assert');
const { getPanelKey } = require('../chat-panel');

const dummyCid = 'cc0d3739-1234-5678-90ab';
assert.strictEqual(getPanelKey({ cid: dummyCid }), 'rc_cc0d3739');

const dummySession = { name: 'agy_test_bot' };
assert.strictEqual(getPanelKey(dummySession), 'agy_test_bot');

console.log('✅ test-prompt-dispatcher passed!');
