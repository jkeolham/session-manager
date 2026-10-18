const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cssPath = path.join(__dirname, '../media/chat.css');
const jsPath = path.join(__dirname, '../media/chat.js');

assert(fs.existsSync(cssPath), 'media/chat.css must exist');
assert(fs.existsSync(jsPath), 'media/chat.js must exist');

const jsContent = fs.readFileSync(jsPath, 'utf-8');
assert(jsContent.includes('escapeHtml'), 'chat.js must include escapeHtml helper');
assert(jsContent.includes('renderTurn'), 'chat.js must include renderTurn helper');

console.log('✅ test-chat-ui-assets passed!');
