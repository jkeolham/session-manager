const http = require('http');
const assert = require('assert');

// test-server-api.js

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 8799,
      path,
      ...options,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function run() {
  console.log('Starting test-server-api...');
  const { createServer } = await import('../server.mjs');
  const server = await createServer({ port: 8799, bindHost: '127.0.0.1' });
  try {
    // 1. GET /api/sessions
    const resSessions = await request('/api/sessions');
    assert.strictEqual(resSessions.status, 200, 'GET /api/sessions should return 200');
    const sessions = JSON.parse(resSessions.body);
    assert(Array.isArray(sessions.agy), 'sessions.agy should be an array');
    assert(Array.isArray(sessions.claude), 'sessions.claude should be an array');
    assert(Array.isArray(sessions.codex), 'sessions.codex should be an array');
    assert(Array.isArray(sessions.other || sessions.others), 'sessions.other should be an array');

    // 2. GET /api/transcript with missing query params -> 400
    const resInvalid = await request('/api/transcript');
    assert.strictEqual(resInvalid.status, 400, 'GET /api/transcript without params should return 400');

    // 3. POST /api/send with missing fields -> 400
    const resSendInvalid = await request('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resSendInvalid.status, 400, 'POST /api/send without fields should return 400');

    console.log('✅ test-server-api passed!');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ test-server-api failed:', err);
  process.exit(1);
});
