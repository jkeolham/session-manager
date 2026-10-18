const assert = require('assert');

async function runTests() {
  console.log('Running session discovery tests...');
  const { getCategorizedSessions } = require('../session-discovery');

  const categories = await getCategorizedSessions();

  assert(categories, 'Categories object should exist');
  assert(Array.isArray(categories.agy), 'categories.agy should be an array');
  assert(Array.isArray(categories.claude), 'categories.claude should be an array');
  assert(Array.isArray(categories.codex), 'categories.codex should be an array');
  assert(Array.isArray(categories.other), 'categories.other should be an array');

  console.log(`Discovered:`);
  console.log(`- AGY sessions: ${categories.agy.length}`);
  console.log(`- Claude sessions: ${categories.claude.length}`);
  console.log(`- Codex sessions: ${categories.codex.length}`);
  console.log(`- Other sessions: ${categories.other.length}`);

  assert(categories.agy.length >= 10, `Expected at least 10 agy sessions, got ${categories.agy.length}`);
  
  const musicSession = categories.agy.find(s => s.name === 'agy_jknas_music');
  assert(musicSession, 'agy_jknas_music session should be found');
  assert(musicSession.title, 'agy_jknas_music should have a human-readable title');
  console.log(`Verified title for agy_jknas_music: "${musicSession.title}"`);

  assert(categories.claude.length >= 15, `Expected at least 15 claude sessions, got ${categories.claude.length}`);

  console.log('✅ All session discovery tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
