import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

test('Server initializes with agentBridge and provides /api/remote-url', async () => {
  const port = 8795;
  const app = await createServer({ port, bindHost: '127.0.0.1' });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/remote-url?cid=test-cid`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(typeof data, 'object');
    assert.strictEqual('url' in data, true);

    // Test POST /api/send with mock agentBridge
    const { agentBridge } = await import('../server.mjs');
    let promptSent = null;
    agentBridge.sendPrompt = (cid, text, attachments) => {
      promptSent = { cid, text, attachments };
      return true;
    };

    const postRes = await fetch(`http://127.0.0.1:${port}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cid: '3e733bed-4c4e-41ae-9a86-c5d8812a4af0',
        text: 'hello bridge test'
      })
    });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.ok, true);
    assert.strictEqual(postData.bridge, 'agent-bridge');
    assert.strictEqual(promptSent?.cid, '3e733bed-4c4e-41ae-9a86-c5d8812a4af0');
    assert.strictEqual(promptSent?.text, 'hello bridge test');
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
});

