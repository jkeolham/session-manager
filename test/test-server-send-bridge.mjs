import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from '../server.mjs';

const require = createRequire(import.meta.url);
// Same module instance server.mjs uses — patched so tests never reach the real
// daemon bridge (an unmocked run injects a turn into a live conversation).
const daemonBridge = require('../daemon-bridge.js');

test('/api/send routes Antigravity conversations through the daemon bridge only', async () => {
  const port = 8795;
  const app = await createServer({ port, bindHost: '127.0.0.1' });
  const original = daemonBridge.sendPrompt;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/remote-url?cid=test-cid`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual('url' in (await res.json()), true);

    let sent = null;
    daemonBridge.sendPrompt = async (cid, text) => { sent = { cid, text }; return {}; };

    const cid = '11111111-2222-3333-4444-555555555555';
    const ok = await fetch(`http://127.0.0.1:${port}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid, text: 'mocked bridge test' })
    });
    assert.strictEqual(ok.status, 200);
    const data = await ok.json();
    assert.strictEqual(data.bridge, 'daemon');
    assert.deepStrictEqual(sent, { cid, text: 'mocked bridge test' });

    // Bridge down: report it, never fall back to a tmux TUI (that splits the conversation).
    daemonBridge.sendPrompt = async () => { throw new Error('bridge not running'); };
    const down = await fetch(`http://127.0.0.1:${port}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid, text: 'should fail' })
    });
    assert.strictEqual(down.status, 503);
    assert.match((await down.json()).error, /bridge not running/);
  } finally {
    daemonBridge.sendPrompt = original;
    await new Promise(resolve => app.close(resolve));
  }
});
