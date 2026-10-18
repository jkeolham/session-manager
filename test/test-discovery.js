const assert = require('assert');

async function runTests() {
  console.log('Running session discovery tests...');
  const { getCategorizedSessions } = require('../session-discovery');

  const categories = await getCategorizedSessions();

  assert(categories, 'Categories object should exist');
  assert(Array.isArray(categories.remoteControl), 'categories.remoteControl should be an array');
  assert(Array.isArray(categories.agy), 'categories.agy should be an array');
  assert(Array.isArray(categories.claude), 'categories.claude should be an array');
  assert(Array.isArray(categories.codex), 'categories.codex should be an array');
  assert(Array.isArray(categories.other), 'categories.other should be an array');

  console.log('Discovered:');
  console.log(`- Remote Control sessions: ${categories.remoteControl.length}`);
  console.log(`- AGY tmux sessions: ${categories.agy.length}`);
  console.log(`- Claude sessions: ${categories.claude.length}`);
  console.log(`- Codex sessions: ${categories.codex.length}`);
  console.log(`- Other sessions: ${categories.other.length}`);

  assert(categories.remoteControl.length >= 10, `Expected at least 10 remote control sessions, got ${categories.remoteControl.length}`);
  assert(categories.agy.length >= 10, `Expected at least 10 agy sessions, got ${categories.agy.length}`);
  
  const musicSession = categories.remoteControl.find(s => s.title.includes('뮤직라이브러리'));
  assert(musicSession, 'JKNAS 뮤직라이브러리 should be in remote control sessions');
  console.log(`Verified remote control session: "${musicSession.title}" (${musicSession.cid})`);

  console.log('✅ All session discovery tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
