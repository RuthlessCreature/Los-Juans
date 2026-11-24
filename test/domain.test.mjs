import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MISSION, isSecureModelUrl, publicSnapshot, validateMissionPatch, validateOpportunity, actionPolicy } from '../src/domain.mjs';

test('default mandate prevents monetary and external actions', () => {
  assert.equal(DEFAULT_MISSION.newCashSpendLimitCny, 0);
  assert.equal(DEFAULT_MISSION.outboundActionsEnabled, false);
  assert.equal(DEFAULT_MISSION.modelCallsEnabled, false);
});

test('mission changes cannot override safety settings', () => {
  assert.deepEqual(validateMissionPatch({ statement: '研究新的合法服务', firstRevenueTargetCny: 1 }), { statement: '研究新的合法服务', firstRevenueTargetCny: 1 });
  assert.throws(() => validateMissionPatch({ outboundActionsEnabled: true }));
  assert.throws(() => validateMissionPatch({ newCashSpendLimitCny: 999999 }));
  assert.throws(() => validateMissionPatch({ firstRevenueTargetCny: -1 }));
});

test('HTTPS is the default transport requirement', () => {
  assert.equal(isSecureModelUrl('http://example.com/v1'), false);
  assert.equal(isSecureModelUrl('https://example.com/v1'), true);
  assert.equal(isSecureModelUrl('https://user:pass@example.com/v1'), false);
});

test('public status never includes mission statement or secrets', () => {
  const status = publicSnapshot({ state: DEFAULT_MISSION, discoveryCount: 3, eventCount: 4, latestDiscovery: null, queuedTaskCount: 2 });
  assert.equal(status.activity.discoveryCount, 3);
  assert.equal(status.activity.queuedTaskCount, 2);
  assert.equal(status.finance.verifiedRevenueCny, 0);
  assert.equal(JSON.stringify(status).includes(DEFAULT_MISSION.statement), false);
});

test('commercial opportunities need a real HTTPS source and stated buyer signal', () => {
  const valid = { title: 'Potential legitimate business need', sourceUrl: 'https://example.com/a', buyerSignal: 'Public evidence of a buyer explaining the need', hypothesis: 'A low-cost service might solve that need' };
  assert.deepEqual(validateOpportunity(valid), valid);
  assert.throws(() => validateOpportunity({ ...valid, sourceUrl: 'http://example.com/a' }));
  assert.throws(() => validateOpportunity({ ...valid, buyerSignal: 'no proof' }));
});

test('commercially sensitive actions require approval regardless of LLM output', () => {
  assert.equal(actionPolicy('analyze-evidence'), 'allowed-in-read-only-mode');
  assert.equal(actionPolicy('contact-person'), 'requires-human-approval');
  assert.equal(actionPolicy('purchase'), 'requires-human-approval');
  assert.equal(actionPolicy('self-change-permissions'), 'prohibited');
});
