import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentBridgeManager } from '../agent-bridge.mjs';

test('AgentBridgeManager exports required API methods', () => {
  const mgr = new AgentBridgeManager();
  assert.strictEqual(typeof mgr.getWorker, 'function');
  assert.strictEqual(typeof mgr.sendPrompt, 'function');
  assert.strictEqual(typeof mgr.closeWorker, 'function');
  assert.strictEqual(typeof mgr.closeAll, 'function');
  mgr.closeAll();
});

test('AgentBridgeManager formats prompt with attachments correctly', () => {
  const mgr = new AgentBridgeManager();
  // Mock worker
  const written = [];
  const fakeProc = {
    stdin: {
      write: (data) => written.push(data)
    },
    killed: false
  };
  mgr.workers.set('test-cid', { proc: fakeProc, lastUsed: 0 });

  mgr.sendPrompt('test-cid', 'hello', [{ path: '/tmp/test.jpg' }]);
  assert.strictEqual(written.length, 1);
  const parsed = JSON.parse(written[0]);
  assert.strictEqual(parsed.event, 'user');
  assert.ok(parsed.message.content.includes('hello'));
  assert.ok(parsed.message.content.includes('[첨부 파일]\n- /tmp/test.jpg'));
  mgr.closeAll();
});

test('AgentBridgeManager handles chunked stdout and relay-url emission', () => {
  const mgr = new AgentBridgeManager();
  const worker = {
    cid: 'test-cid-2',
    lineRemainder: '',
    proc: { killed: false, stdin: { write: () => {} }, stdout: null, stderr: null }
  };
  mgr.workers.set('test-cid-2', worker);

  const receivedEvents = [];
  mgr.on('event', (ev) => receivedEvents.push(ev));

  // Simulate chunk 1 (partial)
  worker.lineRemainder += '{"event":"tu';
  // Simulate chunk 2 (completed line + next partial)
  const chunk2 = 'rn","turn_id":1}\n{"event":"status';
  worker.lineRemainder += chunk2;
  const lines = worker.lineRemainder.split('\n');
  worker.lineRemainder = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      mgr.emit('event', { cid: 'test-cid-2', data: JSON.parse(trimmed) });
    }
  }

  assert.strictEqual(receivedEvents.length, 1);
  assert.strictEqual(receivedEvents[0].data.event, 'turn');
  assert.strictEqual(receivedEvents[0].data.turn_id, 1);
  assert.strictEqual(worker.lineRemainder, '{"event":"status');
  mgr.closeAll();
});

test('AgentBridgeManager handles diverse attachment formats safely', () => {
  const mgr = new AgentBridgeManager();
  const written = [];
  const fakeProc = {
    stdin: { write: (d) => written.push(d) },
    killed: false
  };
  mgr.workers.set('test-cid-att', { proc: fakeProc, lastUsed: 0 });

  mgr.sendPrompt('test-cid-att', 'check attachments', [
    { destPath: '/tmp/dest.txt' },
    { url: '/uploads/img.png' },
    '/simple/path.pdf'
  ]);
  const parsed = JSON.parse(written[0]);
  assert.ok(parsed.message.content.includes('/tmp/dest.txt'));
  assert.ok(parsed.message.content.includes('/uploads/img.png'));
  assert.ok(parsed.message.content.includes('/simple/path.pdf'));
  assert.ok(!parsed.message.content.includes('undefined'));
  mgr.closeAll();
});



