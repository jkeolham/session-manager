const http = require('http');
const assert = require('assert');

async function run() {
  console.log('Starting test-server-stream...');
  const { createServer } = await import('../server.mjs');
  const server = await createServer({ port: 8798, bindHost: '127.0.0.1' });
  try {
    const req = http.request({
      host: '127.0.0.1',
      port: 8798,
      path: '/api/stream?cid=test-cid&session=test-sess',
      headers: { 'Accept': 'text/event-stream' }
    });

    const receivedChunks = await new Promise((resolve, reject) => {
      let data = '';
      req.on('response', res => {
        assert.strictEqual(res.statusCode, 200, 'SSE status code should be 200');
        assert(res.headers['content-type'].includes('text/event-stream'), 'Content-Type should be text/event-stream');
        res.on('data', chunk => {
          data += chunk.toString();
          if (data.includes('event: connected') || data.includes('event: ping')) {
            req.destroy();
            resolve(data);
          }
        });
      });
      req.on('error', (err) => {
        if (req.destroyed) resolve(data);
        else reject(err);
      });
      req.end();
    });

    assert(receivedChunks.includes('event: connected'), 'Stream should emit connected event');
    console.log('✅ test-server-stream passed!');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ test-server-stream failed:', err);
  process.exit(1);
});
