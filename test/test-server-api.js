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
    assert(sessions.agy.length > 0, 'sessions.agy should have sessions');
    assert(sessions.agy[0].displayName, 'sessions.agy items should have displayName');
    assert(Array.isArray(sessions.claude), 'sessions.claude should be an array');
    assert(Array.isArray(sessions.codex), 'sessions.codex should be an array');
    assert(Array.isArray(sessions.other || sessions.others), 'sessions.other should be an array');

    // 1b. GET /api/models
    const resModels = await request('/api/models');
    assert.strictEqual(resModels.status, 200, 'GET /api/models should return 200');
    const modelsData = JSON.parse(resModels.body);
    assert(modelsData.ok, 'modelsData.ok should be true');
    assert(Array.isArray(modelsData.models), 'modelsData.models should be an array');
    assert(modelsData.models.length >= 3, 'modelsData.models should have at least 3 models');
    assert(modelsData.models.some(m => m.id === 'gemini-3.8-flash-high'), 'should include gemini-3.8-flash-high');

    // 2. GET /api/transcript with missing query params -> 400
    const resInvalid = await request('/api/transcript');
    assert.strictEqual(resInvalid.status, 400, 'GET /api/transcript without params should return 400');

    // 2b. GET /api/transcript with terminal session -> terminalOutput
    const resTerm = await request('/api/transcript?session=shopping_monitoring');
    assert.strictEqual(resTerm.status, 200);
    const termData = JSON.parse(resTerm.body);
    assert(typeof termData.terminalOutput === 'string', 'terminal session should return terminalOutput');

    // 3. POST /api/send with missing fields -> 400
    const resSendInvalid = await request('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resSendInvalid.status, 400, 'POST /api/send without fields should return 400');

    // 4. POST /api/upload
    const resUpload = await request('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ name: 'test.txt', type: 'text/plain', data: Buffer.from('hello attachment').toString('base64') }]
      })
    });
    assert.strictEqual(resUpload.status, 200, 'POST /api/upload should return 200');
    const uploadData = JSON.parse(resUpload.body);
    assert(uploadData.ok && uploadData.files.length === 1);
    assert(uploadData.files[0].url.startsWith('/uploads/'));

    // 5. GET /uploads/<safeName>
    const resUploadedFile = await request(uploadData.files[0].url);
    assert.strictEqual(resUploadedFile.status, 200);
    assert.strictEqual(resUploadedFile.body, 'hello attachment');

    // 6. Check static asset Cache-Control is no-cache, no-store
    const resJs = await request('/mobile.js');
    assert.strictEqual(resJs.status, 200);
    assert(resJs.headers['cache-control'].includes('no-cache'), 'Static files should disable caching');

    console.log('✅ test-server-api passed!');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ test-server-api failed:', err);
  process.exit(1);
});
