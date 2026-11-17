import assert from 'node:assert';
import { createServer } from '../server.mjs';

async function runAutomationsTests() {
  const PORT = 8894;
  const server = await createServer({ port: PORT, bindHost: '127.0.0.1' });
  console.log(`Automations test server running on port ${PORT}`);

  try {
    // 1. GET /api/automations should return 200 with scheduled, alwaysOn, paused arrays
    const res = await fetch(`http://127.0.0.1:${PORT}/api/automations`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert(Array.isArray(data.scheduled), 'data.scheduled must be an array');
    assert(Array.isArray(data.alwaysOn), 'data.alwaysOn must be an array');
    assert(Array.isArray(data.paused), 'data.paused must be an array');
    console.log(`✅ GET /api/automations passed (scheduled: ${data.scheduled.length}, alwaysOn: ${data.alwaysOn.length}, paused: ${data.paused.length})`);

    // 2. GET /api/automations/log validation: missing file parameter -> 400
    const missingRes = await fetch(`http://127.0.0.1:${PORT}/api/automations/log`);
    assert.strictEqual(missingRes.status, 400);
    console.log('✅ Missing file parameter validation passed (400)');

    // 3. GET /api/automations/log security: path outside home -> 403
    const outsideRes = await fetch(`http://127.0.0.1:${PORT}/api/automations/log?file=/etc/passwd`);
    assert.strictEqual(outsideRes.status, 403);
    console.log('✅ Path outside home defense passed (403)');

    // 4. GET /api/automations/log security: sensitive file (.env) -> 403
    const sensitiveRes = await fetch(`http://127.0.0.1:${PORT}/api/automations/log?file=/home/ttolmany/.env`);
    assert.strictEqual(sensitiveRes.status, 403);
    console.log('✅ Sensitive file defense passed (403)');

    // 5. POST /api/automations/run-now security: unauthorized path -> 403
    const badRunRes = await fetch(`http://127.0.0.1:${PORT}/api/automations/run-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ script: '/tmp/malicious.py' })
    });
    assert.strictEqual(badRunRes.status, 403);
    console.log('✅ Unauthorized script execution defense passed (403)');

    // 6. POST /api/automations/run-now security: non-python script rejection -> 400
    const nonPyRes = await fetch(`http://127.0.0.1:${PORT}/api/automations/run-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ script: '/home/ttolmany/scripts/malicious.sh' })
    });
    assert.strictEqual(nonPyRes.status, 400);
    console.log('✅ Non-python script rejection passed (400)');

    console.log('\n🎉 ALL 6 AUTOMATIONS API TESTS PASSED!');
  } finally {
    server.close();
  }
}

runAutomationsTests().catch((err) => {
  console.error('❌ Automations test failed:', err);
  process.exit(1);
});
