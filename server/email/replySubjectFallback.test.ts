import test from 'node:test';
import assert from 'node:assert/strict';
import { firstMatchingSubjectTicket, normalizedReplySubject } from './replySubjectFallback';

test('normalizes reply, forward and external prefixes without changing ticket text', () => {
  assert.equal(normalizedReplySubject('Re: CS TEST 08 - Different Agent Responds'),
    'cs test 08 - different agent responds');
  assert.equal(normalizedReplySubject('RE: [EXTERNAL] Fwd:   Valuation   Request '), 'valuation request');
  assert.equal(normalizedReplySubject('Renewal: KCK 681F'), 'renewal: kck 681f');
});

test('keeps later customer replies on the original subject ticket', () => {
  const original = {id: 7, subject: '[EXTERNAL] Valuation report KDA 001A'};
  const duplicate = {id: 12, subject: 'Re: Valuation report KDA 001A'};
  assert.equal(firstMatchingSubjectTicket('RE: RE: Valuation report KDA 001A', [original, duplicate]), original);
  assert.equal(firstMatchingSubjectTicket('Thank you', [original, duplicate]), undefined);
});
