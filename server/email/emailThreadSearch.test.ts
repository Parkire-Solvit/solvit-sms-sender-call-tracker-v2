import assert from 'node:assert/strict';
import test from 'node:test';
import { emailThreadSearchPattern } from './emailRepository';

test('email thread search ignores blank input', () => {
  assert.equal(emailThreadSearchPattern(), null);
  assert.equal(emailThreadSearchPattern('   '), null);
});

test('email thread search trims input and escapes SQL wildcard characters', () => {
  assert.equal(emailThreadSearchPattern('  Carol  '), '%Carol%');
  assert.equal(emailThreadSearchPattern('REF_50%\\done'), '%REF\\_50\\%\\\\done%');
});
