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
  assert(js.includes('serviceWorker'), 'mobile.js should register service worker');
  assert(js.includes('beforeinstallprompt'), 'mobile.js should handle PWA install prompt');

  // PWA checks
  const manifestPath = path.join(__dirname, '../public/manifest.json');
  const swPath = path.join(__dirname, '../public/sw.js');
  const icon192Path = path.join(__dirname, '../public/icons/icon-192.png');
  const icon512Path = path.join(__dirname, '../public/icons/icon-512.png');

  assert(fs.existsSync(manifestPath), 'manifest.json should exist');
  assert(fs.existsSync(swPath), 'sw.js should exist');
  assert(fs.existsSync(icon192Path), 'icon-192.png should exist');
  assert(fs.existsSync(icon512Path), 'icon-512.png should exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.display === 'fullscreen' || manifest.display === 'standalone', 'PWA display should be fullscreen or standalone');
  assert(manifest.icons && manifest.icons.length >= 2, 'manifest should have multiple icons');
  assert(html.includes('manifest.json'), 'index.html must link to manifest.json');

  const sw = fs.readFileSync(swPath, 'utf8');
  assert(sw.includes('install'), 'sw.js must handle install');
  assert(sw.includes('fetch'), 'sw.js must handle fetch');

  console.log('✅ test-mobile-ui-assets passed!');
}

run();
