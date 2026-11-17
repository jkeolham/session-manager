import assert from 'node:assert';
import { createServer } from '../server.mjs';

async function runRenameTests() {
  const PORT = 8892;
  const server = await createServer({ port: PORT, bindHost: '127.0.0.1' });
  console.log(`Rename test server running on port ${PORT}`);

  try {
    // 1. Empty title should return 400
    const emptyRes = await fetch(`http://127.0.0.1:${PORT}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: '0627caa5-1a0c-43ec-a254-75f5a7e4576b', title: '' })
    });
    assert.strictEqual(emptyRes.status, 400);
    console.log('✅ Empty title validation test passed (400)');

    // 2. Long title > 120 chars should return 400
    const longRes = await fetch(`http://127.0.0.1:${PORT}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: '0627caa5-1a0c-43ec-a254-75f5a7e4576b', title: 'a'.repeat(150) })
    });
    assert.strictEqual(longRes.status, 400);
    console.log('✅ Long title validation test passed (400)');

    // 3. Invalid CID format should return 400
    const badCidRes = await fetch(`http://127.0.0.1:${PORT}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: 'not-a-valid-uuid-format', title: 'New Title' })
    });
    assert.strictEqual(badCidRes.status, 400);
    console.log('✅ Invalid CID validation test passed (400)');

    // 4. Invalid Tmux session injection should return 400
    const badTmuxRes = await fetch(`http://127.0.0.1:${PORT}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ session: 'evil;rm -rf /', newName: 'hacked' })
    });
    assert.strictEqual(badTmuxRes.status, 400);
    console.log('✅ Tmux injection validation test passed (400)');

    // 5. Valid rename for Antigravity session (0627caa5-1a0c-43ec-a254-75f5a7e4576b)
    const validRes = await fetch(`http://127.0.0.1:${PORT}/api/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: '0627caa5-1a0c-43ec-a254-75f5a7e4576b', title: '감사 및 리뷰어' })
    });
    assert.strictEqual(validRes.status, 200);
    const validJson = await validRes.json();
    assert.strictEqual(validJson.ok, true);
    assert.strictEqual(validJson.title, '감사 및 리뷰어');
    console.log('✅ Valid rename test passed (200, ok: true)');

    // 6. Persistent custom title verification: ensure custom_titles.json overrides
    const { execFileSync } = await import('node:child_process');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(__dirname, '..');
    const out = execFileSync('python3', [path.join(projectRoot, 'remote-sessions.py'), '--titles'], {
      encoding: 'utf-8',
      cwd: projectRoot
    });
    const titles = JSON.parse(out);
    assert(titles['0627caa5-1a0c-43ec-a254-75f5a7e4576b'], 'CID must exist in remote-sessions titles');
    assert.strictEqual(titles['0627caa5-1a0c-43ec-a254-75f5a7e4576b'].title, '감사 및 리뷰어');
    console.log('✅ Persistent custom title override test passed!');

    // 7. Verify Antigravity annotations pbtxt file has updated title
    const fs = await import('node:fs');
    const os = await import('node:os');
    const pbtxtPath = path.join(os.homedir(), '.gemini/antigravity-cli/annotations/0627caa5-1a0c-43ec-a254-75f5a7e4576b.pbtxt');
    assert(fs.existsSync(pbtxtPath), 'Annotations pbtxt file must exist');
    const pbtxtContent = fs.readFileSync(pbtxtPath, 'utf-8');
    assert(pbtxtContent.includes('title:"감사 및 리뷰어"'), 'Annotations pbtxt must contain updated title');
    console.log('✅ Antigravity annotations pbtxt title sync verified!');

    console.log('\n🎉 ALL 7 RENAME API TESTS PASSED!');
  } finally {
    server.close();
  }
}

runRenameTests().catch((err) => {
  console.error('❌ Rename test failed:', err);
  process.exit(1);
});
