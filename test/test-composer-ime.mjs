import test from 'node:test';
import assert from 'node:assert/strict';

test('isComposing flag blocks premature submission on Enter key', () => {
  let isComposing = false;
  let submitted = false;

  function handleKeydown(e) {
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      submitted = true;
    }
  }

  // During IME composition
  isComposing = true;
  handleKeydown({ key: 'Enter', shiftKey: false, keyCode: 229, isComposing: true });
  assert.strictEqual(submitted, false, 'Enter during IME composition must NOT submit');

  // After IME composition ends
  isComposing = false;
  handleKeydown({ key: 'Enter', shiftKey: false, keyCode: 13, isComposing: false });
  assert.strictEqual(submitted, true, 'Enter after composition completes must submit');
});
