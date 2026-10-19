const fs = require('fs');
const path = require('path');
const assert = require('assert');

function run() {
  console.log('Starting test-mobile-ui-assets...');
  const htmlPath = path.join(__dirname, '../public/index.html');
  const cssPath = path.join(__dirname, '../public/mobile.css');
  const jsPath = path.join(__dirname, '../public/mobile.js');

  assert(fs.existsSync(htmlPath), 'index.html should exist');
  assert(fs.existsSync(cssPath), 'mobile.css should exist');
  assert(fs.existsSync(jsPath), 'mobile.js should exist');

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert(html.includes('viewport'), 'index.html must include viewport meta tag');
  assert(html.includes('drawer'), 'index.html must include drawer for sessions');
  assert(html.includes('chat-container'), 'index.html must include chat container');
  assert(html.includes('composer'), 'index.html must include message composer');

  const css = fs.readFileSync(cssPath, 'utf8');
  assert(css.includes('--safe-area-inset') || css.includes('env(safe-area-inset'), 'mobile.css should handle safe area');
  assert(css.includes('bubble'), 'mobile.css should style chat bubbles');

  const js = fs.readFileSync(jsPath, 'utf8');
  assert(js.includes('EventSource'), 'mobile.js should subscribe via EventSource');
  assert(js.includes('/api/sessions'), 'mobile.js should fetch sessions');
  assert(js.includes('/api/send'), 'mobile.js should post messages');

  console.log('✅ test-mobile-ui-assets passed!');
}

run();
