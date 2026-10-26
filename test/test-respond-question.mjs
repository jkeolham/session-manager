import assert from 'node:assert';
import { createServer } from '../server.mjs';

async function runRespondQuestionTests() {
  const PORT = 8893;
  const server = await createServer({ port: PORT, bindHost: '127.0.0.1' });
  console.log(`Respond-question test server running on port ${PORT}`);

  try {
    // 1. Missing or invalid CID should return 400
    const emptyCidRes = await fetch(`http://127.0.0.1:${PORT}/api/respond-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: '', responses: [] })
    });
    assert.strictEqual(emptyCidRes.status, 400);
    console.log('✅ Empty CID validation test passed (400)');

    const badCidRes = await fetch(`http://127.0.0.1:${PORT}/api/respond-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({ cid: 'bad-cid-1234', responses: [] })
    });
    assert.strictEqual(badCidRes.status, 400);
    console.log('✅ Invalid CID format validation test passed (400)');

    // 2. CSRF Defense: Cross-origin POST should return 403
    const csrfRes = await fetch(`http://127.0.0.1:${PORT}/api/respond-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://evil-attacker.com'
      },
      body: JSON.stringify({ cid: '0627caa5-1a0c-43ec-a254-75f5a7e4576b', responses: [] })
    });
    assert.strictEqual(csrfRes.status, 403);
    console.log('✅ CSRF Defense test passed: Cross-origin POST returned 403');

    // 3. Valid CID structure validation
    // Note: When bridge is alive, this contacts the daemon LS. If no waiting interaction is pending, it should return 500 with proper error message.
    const validRes = await fetch(`http://127.0.0.1:${PORT}/api/respond-question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': `http://127.0.0.1:${PORT}`
      },
      body: JSON.stringify({
        cid: '0627caa5-1a0c-43ec-a254-75f5a7e4576b',
        responses: [
          {
            question: '테스트 질문',
            selectedOptionIds: ['1'],
            writeInResponse: '',
            skipped: false
          }
        ],
        cancelled: false
      })
    });
    // Either 200 (if handled) or 500 (if no interaction is waiting for this session), but NOT 400 or 403
    assert.ok([200, 500].includes(validRes.status), `Unexpected status: ${validRes.status}`);
    console.log(`✅ Valid interaction payload dispatched properly (status: ${validRes.status})`);

    console.log('\n🎉 ALL RESPOND QUESTION TESTS PASSED!');
  } finally {
    server.close();
  }
}

runRespondQuestionTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
