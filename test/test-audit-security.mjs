import http from 'node:http';
import assert from 'node:assert';
import { createServer } from '../server.mjs';

async function runAuditRegressionTests() {
  const PORT = 8891;
  const server = await createServer({ port: PORT, bindHost: '127.0.0.1' });
  console.log(`Test server running on port ${PORT}`);

  try {
    // 1. Test CSRF Defense: Cross-Origin POST should return 403
    const csrfRes = await fetch(`http://127.0.0.1:${PORT}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil.com',
        'Host': `127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ text: 'malicious payload' })
    });
    assert.strictEqual(csrfRes.status, 403, 'CSRF request must be rejected with 403');
    console.log('✅ CSRF Defense test passed: Cross-origin POST returned 403');

    // 2. Test /api/diff RCE Defense: Invalid session name should return 400
    const diffRes = await fetch(`http://127.0.0.1:${PORT}/api/diff?session=";echo+pwned;#`);
    assert.strictEqual(diffRes.status, 400, 'Invalid session parameter must return 400');
    console.log('✅ /api/diff RCE Defense test passed: Invalid session param returned 400');

    // 3. Test File Upload Extension Whitelist: Disallowed extensions should return 400
    const htmlUploadRes = await fetch(`http://127.0.0.1:${PORT}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({
        files: [{ name: 'evil.html', data: 'PGgxPkhhY2tlZDwvaDE+' }]
      })
    });
    assert.strictEqual(htmlUploadRes.status, 400, '.html upload must return 400');
    console.log('✅ Upload XSS Defense test passed: .html upload returned 400');

    const svgUploadRes = await fetch(`http://127.0.0.1:${PORT}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({
        files: [{ name: 'evil.svg', data: 'PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+' }]
      })
    });
    assert.strictEqual(svgUploadRes.status, 400, '.svg upload must return 400');
    console.log('✅ Upload XSS Defense test passed: .svg upload returned 400');

    // 4. Test Allowed File Upload (.txt)
    const txtUploadRes = await fetch(`http://127.0.0.1:${PORT}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({
        files: [{ name: 'test_safe.txt', data: 'SGVsbG8gU2FmZSBVcGxvYWQ=' }]
      })
    });
    assert.strictEqual(txtUploadRes.status, 200, '.txt upload must return 200');
    const txtUploadJson = await txtUploadRes.json();
    assert.strictEqual(txtUploadJson.ok, true);
    console.log('✅ Upload Allowed test passed: .txt upload returned 200');

    // 5. Test /uploads/ Security Headers
    const fileUrl = txtUploadJson.files[0].url;
    const servedRes = await fetch(`http://127.0.0.1:${PORT}${fileUrl}`);
    assert.strictEqual(servedRes.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(servedRes.headers.get('content-security-policy').includes("default-src 'none'"));
    console.log('✅ /uploads/ Security Headers test passed: CSP & nosniff verified');

    console.log('\n🎉 ALL 5 AUDIT SECURITY REGRESSION TESTS PASSED!');
  } finally {
    server.close();
  }
}

runAuditRegressionTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
