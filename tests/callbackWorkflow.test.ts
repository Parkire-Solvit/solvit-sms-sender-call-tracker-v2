import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPhoneNumbers, hasReachedMaxAttempts, normalizePhone } from '../insuranceCallbacks';

test('normalizes Kenyan phone formats to the same canonical number', () => {
  assert.equal(normalizePhone('0722 123 456'), '722123456');
  assert.equal(normalizePhone('+254 722 123 456'), '722123456');
  assert.equal(normalizePhone('254722123456'), '722123456');
});

test('extracts and deduplicates multiple customer phone numbers', () => {
  assert.deepEqual(
    extractPhoneNumbers('0722 123 456 / +254 733 987 654, 0722123456'),
    ['722123456', '733987654']
  );
});

test('requires both outgoing calls and SMS before automatic closure', () => {
  const settings = { max_attempts: 4, max_sms_attempts: 4 };
  assert.equal(hasReachedMaxAttempts({ attempt_count: 4, sms_count: 4 }, settings), true);
  assert.equal(hasReachedMaxAttempts({ attempt_count: 10, sms_count: 3 }, settings), false);
  assert.equal(hasReachedMaxAttempts({ attempt_count: 3, sms_count: 10 }, settings), false);
});
