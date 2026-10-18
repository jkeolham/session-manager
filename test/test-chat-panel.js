const assert = require('assert');
const { getPanelKey } = require('../chat-panel');

assert.strictEqual(getPanelKey({ cid: 'cc0d3739-test' }), 'rc_cc0d3739');
assert.strictEqual(getPanelKey({ name: 'agy_test_sess' }), 'agy_test_sess');
console.log('✅ test-chat-panel passed!');
