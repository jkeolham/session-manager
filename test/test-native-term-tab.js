const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Verify CSS styles for in-window native terminal
const cssContent = fs.readFileSync(path.join(__dirname, '../media/chat.css'), 'utf-8');
assert(cssContent.includes('#view-native-term'), 'chat.css must style #view-native-term');
assert(cssContent.includes('.native-term-toolbar'), 'chat.css must style .native-term-toolbar');
assert(cssContent.includes('#native-terminal-container'), 'chat.css must style #native-terminal-container');
assert(cssContent.includes('#native-terminal-output'), 'chat.css must style #native-terminal-output');

// 2. Verify JS logic in media/chat.js
const jsContent = fs.readFileSync(path.join(__dirname, '../media/chat.js'), 'utf-8');
assert(jsContent.includes('tab-native-term'), 'chat.js must reference tab-native-term');
assert(jsContent.includes('btnOpenPanelTerm'), 'chat.js must attach click handler for panel terminal');
assert(jsContent.includes('btnOpenEditorTerm'), 'chat.js must attach click handler for editor terminal');

// 3. Verify terminal streaming and input in media/terminal.js
const termContent = fs.readFileSync(path.join(__dirname, '../media/terminal.js'), 'utf-8');
assert(termContent.includes('native-terminal-output'), 'terminal.js must stream to native-terminal-output');
assert(termContent.includes('native-term-cmd-input'), 'terminal.js must support native-term-cmd-input');
assert(termContent.includes('btn-native-term-send'), 'terminal.js must support btn-native-term-send');

// 4. Verify chat-panel.js template
const panelContent = fs.readFileSync(path.join(__dirname, '../chat-panel.js'), 'utf-8');
assert(panelContent.includes('id="tab-native-term"'), 'chat-panel.js must contain tab-native-term');
assert(panelContent.includes('내장 터미널'), 'chat-panel.js must show 내장 터미널 label');
assert(panelContent.includes('id="view-native-term"'), 'chat-panel.js must contain view-native-term');
assert(panelContent.includes('id="native-terminal-output"'), 'chat-panel.js must contain native-terminal-output');
assert(panelContent.includes('id="native-term-cmd-input"'), 'chat-panel.js must contain native-term-cmd-input');
assert(panelContent.includes('openNativeTerminal'), 'chat-panel.js must handle openNativeTerminal command');

// 5. Test SessionChatPanelManager constructor with terminal callbacks
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
