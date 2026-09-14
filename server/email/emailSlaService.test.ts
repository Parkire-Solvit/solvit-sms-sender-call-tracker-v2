import test from 'node:test';
import assert from 'node:assert/strict';
import { dueEmailAlerts, recordFirstResponse, resolveEmailSla, startEmailSla } from './emailSlaService';
import type { EmailAlertType, EmailSlaSettings } from './emailTypes';

const settings: EmailSlaSettings = {
  responseMinutes: 30,
  responseWarningMinutes: 20,
  responseUrgentMinutes: 25,
  resolutionMinutes: 120,
  resolutionWarningMinutes: 90,
  resolutionUrgentMinutes: 105,
  holidayDates: [],
};
const received = new Date('2026-09-14T06:00:00.000Z');
const at = (minutes: number) => new Date(received.getTime() + minutes * 60_000);

test('starts the two deadlines from receipt', () => {
  const state = startEmailSla(received, settings);
  assert.equal(state.responseDueAt.toISOString(), at(30).toISOString());
  assert.equal(state.resolutionDueAt.toISOString(), at(120).toISOString());
});

test('first response on the boundary passes and later response breaches', () => {
  assert.equal(recordFirstResponse(startEmailSla(received, settings), at(30)).responseBreached, false);
  assert.equal(recordFirstResponse(startEmailSla(received, settings), at(31)).responseBreached, true);
});

test('only first response counts', () => {
  const first = recordFirstResponse(startEmailSla(received, settings), at(10));
  assert.equal(recordFirstResponse(first, at(40)), first);
});

test('resolution on the boundary passes and later resolution breaches', () => {
  assert.equal(resolveEmailSla(startEmailSla(received, settings), at(120)).resolutionBreached, false);
  assert.equal(resolveEmailSla(startEmailSla(received, settings), at(121)).resolutionBreached, true);
});

test('alerts are due once per stage, even if reconciliation repeats', () => {
  const state = startEmailSla(received, settings);
  const emitted = new Set<EmailAlertType>(['RESPONSE_WARNING']);
  assert.deepEqual(dueEmailAlerts(state, settings, at(26), emitted), ['RESPONSE_URGENT']);
  assert.deepEqual(dueEmailAlerts(state, settings, at(26), new Set(['RESPONSE_WARNING', 'RESPONSE_URGENT'])), []);
});

test('resolution warnings and breach use configured thresholds', () => {
  const state = recordFirstResponse(startEmailSla(received, settings), at(15));
  assert.deepEqual(dueEmailAlerts(state, settings, at(90), new Set()), ['RESOLUTION_WARNING']);
  assert.deepEqual(dueEmailAlerts(state, settings, at(106), new Set()), ['RESOLUTION_WARNING', 'RESOLUTION_URGENT']);
  assert.deepEqual(dueEmailAlerts(state, settings, at(121), new Set()), [
    'RESOLUTION_WARNING', 'RESOLUTION_URGENT', 'RESOLUTION_BREACH',
  ]);
});

test('a resolved thread stops future warnings', () => {
  const state = resolveEmailSla(recordFirstResponse(startEmailSla(received, settings), at(10)), at(20));
  assert.deepEqual(dueEmailAlerts(state, settings, at(200), new Set()), []);
});

test('Friday afternoon deadlines resume Monday morning', () => {
  const friday = new Date('2026-09-18T13:50:00.000Z'); // 4:50 PM Nairobi
  const state = startEmailSla(friday, settings);
  assert.equal(state.responseDueAt.toISOString(), '2026-09-21T05:20:00.000Z');
  assert.equal(state.resolutionDueAt.toISOString(), '2026-09-21T06:50:00.000Z');
});

test('a configured holiday pauses both deadlines and alerts', () => {
  const holidaySettings = { ...settings, holidayDates: ['2026-09-21'] };
  const friday = new Date('2026-09-18T13:50:00.000Z');
  const state = startEmailSla(friday, holidaySettings);
  assert.equal(state.responseDueAt.toISOString(), '2026-09-22T05:20:00.000Z');
  assert.deepEqual(dueEmailAlerts(state, holidaySettings, new Date('2026-09-21T06:00:00.000Z'), new Set()), []);
});
