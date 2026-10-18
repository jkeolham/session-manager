const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Verify CSS styles
const cssContent = fs.readFileSync(path.join(__dirname, '../media/chat.css'), 'utf-8');
assert(cssContent.includes('#view-native-term'), 'chat.css must style #view-native-term');
assert(cssContent.includes('.native-term-card'), 'chat.css must style .native-term-card');
assert(cssContent.includes('.native-term-actions'), 'chat.css must style .native-term-actions');

// 2. Verify JS logic
const jsContent = fs.readFileSync(path.join(__dirname, '../media/chat.js'), 'utf-8');
assert(jsContent.includes('tab-native-term'), 'chat.js must reference tab-native-term');
assert(jsContent.includes('openNativeTerminal'), 'chat.js must post openNativeTerminal message');
assert(jsContent.includes('btnOpenPanelTerm'), 'chat.js must attach click handler for panel terminal');
assert(jsContent.includes('btnOpenEditorTerm'), 'chat.js must attach click handler for editor terminal');

// 3. Verify chat-panel.js template
const panelContent = fs.readFileSync(path.join(__dirname, '../chat-panel.js'), 'utf-8');
assert(panelContent.includes('id="tab-native-term"'), 'chat-panel.js must contain tab-native-term');
assert(panelContent.includes('내장 터미널 ↗'), 'chat-panel.js must show 내장 터미널 ↗ label');
assert(panelContent.includes('id="view-native-term"'), 'chat-panel.js must contain view-native-term');
assert(panelContent.includes('openNativeTerminal'), 'chat-panel.js must handle openNativeTerminal command');

// 4. Test SessionChatPanelManager constructor with terminal callbacks
const { SessionChatPanelManager } = require('../chat-panel');
let attachedSession = null;
let attachedLoc = null;
const mockAttachToSession = (name, loc) => {
  attachedSession = name;
  attachedLoc = loc;
};

const manager = new SessionChatPanelManager(
  { fsPath: '/mock' },
  [],
  () => {},
  mockAttachToSession,
  null
);

assert.strictEqual(typeof manager.attachToSession, 'function');
console.log('✅ test-native-term-tab passed!');
