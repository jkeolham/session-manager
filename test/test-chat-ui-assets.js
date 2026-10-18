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
assert(jsContent.includes('renderMarkdown'), 'chat.js must include renderMarkdown helper');
assert(jsContent.includes('cleanUserMessageText'), 'chat.js must include cleanUserMessageText helper');

// Test the exported helpers in node environment
const { escapeHtml, cleanUserMessageText, renderMarkdown } = require('../media/chat');

const clean = cleanUserMessageText('<USER_REQUEST>테스트 질문</USER_REQUEST><ADDITIONAL_METADATA>meta</ADDITIONAL_METADATA>');
assert.strictEqual(clean, '테스트 질문');

const md = renderMarkdown('### 제목\n[링크](file:///test)\n`코드`');
assert(md.includes('<h3 class="chat-h3">제목</h3>'), 'Should render h3');
assert(md.includes('class="chat-link"'), 'Should render link');
assert(md.includes('class="code-pill">코드</code>'), 'Should render inline code pill');

console.log('✅ test-chat-ui-assets passed!');
