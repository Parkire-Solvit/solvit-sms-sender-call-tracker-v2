import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedReplySubject } from './replySubjectFallback';

test('normalizes reply, forward and external prefixes without changing ticket text', () => {
  assert.equal(normalizedReplySubject('Re: CS TEST 08 - Different Agent Responds'),
    'cs test 08 - different agent responds');
  assert.equal(normalizedReplySubject('RE: [EXTERNAL] Fwd:   Valuation   Request '), 'valuation request');
  assert.equal(normalizedReplySubject('Renewal: KCK 681F'), 'renewal: kck 681f');
});
