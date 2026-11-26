import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

    // 6. Test /api/file: Missing path parameter should return 400
    const missingPathRes = await fetch(`http://127.0.0.1:${PORT}/api/file`);
    assert.strictEqual(missingPathRes.status, 400);
    console.log('✅ /api/file Validation test passed: Missing path returned 400');

    // 7. Test /api/file: Path Traversal outside home directory should return 403
    const traversalRes1 = await fetch(`http://127.0.0.1:${PORT}/api/file?path=/etc/passwd`);
    assert.strictEqual(traversalRes1.status, 403);
    const traversalRes2 = await fetch(`http://127.0.0.1:${PORT}/api/file?path=../../../../etc/shadow`);
    assert.strictEqual(traversalRes2.status, 403);
    console.log('✅ /api/file Path Traversal Defense test passed: External paths returned 403');

    // 8. Test /api/file: Sensitive credential file access should return 403
    const sensitiveRes = await fetch(`http://127.0.0.1:${PORT}/api/file?path=/home/ttolmany/.ssh/id_rsa`);
    assert.strictEqual(sensitiveRes.status, 403);
    console.log('✅ /api/file Sensitive File Defense test passed: .ssh path returned 403');

    // 9. Test /api/file: Non-existent file should return 404
    const notFoundRes = await fetch(`http://127.0.0.1:${PORT}/api/file?path=/home/ttolmany/test_non_existent_${Date.now()}.md`);
    assert.strictEqual(notFoundRes.status, 404);
    console.log('✅ /api/file Not Found test passed: Non-existent file returned 404');

    // 10. Test /api/file: Valid document view (JSON)
    const testDir = path.dirname(new URL(import.meta.url).pathname);
    const testDocPath = path.join(testDir, 'temp-test-doc.md');
    fs.writeFileSync(testDocPath, '# Test Document\n\nHello from file viewer test!\n', 'utf-8');
    try {
      const viewRes = await fetch(`http://127.0.0.1:${PORT}/api/file?path=${encodeURIComponent('file://' + testDocPath)}`);
      assert.strictEqual(viewRes.status, 200);
      const viewData = await viewRes.json();
      assert.strictEqual(viewData.ok, true);
      assert.strictEqual(viewData.name, 'temp-test-doc.md');
      assert.strictEqual(viewData.ext, '.md');
      assert.strictEqual(viewData.isBinary, false);
      assert.ok(viewData.content.includes('# Test Document'));
      console.log('✅ /api/file Document View test passed: JSON viewer payload verified');

      // 11. Test /api/file: Document download (stream with attachment header)
      const downloadRes = await fetch(`http://127.0.0.1:${PORT}/api/file?path=${encodeURIComponent(testDocPath)}&download=1`);
      assert.strictEqual(downloadRes.status, 200);
      const disp = downloadRes.headers.get('content-disposition');
      assert.ok(disp && disp.includes('attachment;'), 'Must have attachment content-disposition');
      assert.ok(disp.includes('temp-test-doc.md'), 'Must have correct filename');
      const downloadedText = await downloadRes.text();
      assert.strictEqual(downloadedText, '# Test Document\n\nHello from file viewer test!\n');
      console.log('✅ /api/file Document Download test passed: Attachment headers & streaming verified');

      // 12. Test /api/file: Korean/Unicode filename download (RFC 6266 / RFC 5987 ERR_INVALID_CHAR regression)
      const koreanDocPath = path.join(testDir, '테스트_한글_도마복음_기획서.md');
      try {
        fs.writeFileSync(koreanDocPath, '# 한글 문서 테스트\n', 'utf8');
        const koreanDownloadRes = await fetch(`http://127.0.0.1:${PORT}/api/file?path=${encodeURIComponent(koreanDocPath)}&download=1`);
        assert.strictEqual(koreanDownloadRes.status, 200, 'Korean filename download must return 200');
        const kDisp = koreanDownloadRes.headers.get('content-disposition');
        assert.ok(kDisp && kDisp.includes('attachment;'), 'Must have attachment header for Korean filename');
        assert.ok(kDisp.includes("filename*=UTF-8''"), 'Must have RFC 5987 UTF-8 encoded filename');
        const kText = await koreanDownloadRes.text();
        assert.strictEqual(kText, '# 한글 문서 테스트\n');
        console.log('✅ /api/file Korean/Unicode Filename Download test passed: RFC 6266/5987 UTF-8 verified');
      } finally {
        if (fs.existsSync(koreanDocPath)) {
          fs.unlinkSync(koreanDocPath);
        }
      }
    } finally {
      if (fs.existsSync(testDocPath)) {
        fs.unlinkSync(testDocPath);
      }
    }

    console.log('\n🎉 ALL 12 AUDIT SECURITY REGRESSION TESTS PASSED!');
  } finally {
    server.close();
  }
}

runAuditRegressionTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
