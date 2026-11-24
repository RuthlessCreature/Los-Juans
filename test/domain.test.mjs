import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MISSION, isSecureModelUrl, publicSnapshot, validateMissionPatch, validateOpportunity, validateAssessment, actionPolicy } from '../src/domain.mjs';

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

test('an unknown buyer becomes a low-confidence finding, never an invented customer', () => {
  const result = validateAssessment({ buyer: '', offer: 'Build a narrow service pilot', test: 'Ask for a real paid order', risk: 'Public comment may be noise', confidence: 88 });
  assert.equal(result.buyerEvidenceMissing, true);
  assert.equal(result.confidence, 20);
  assert.match(result.buyer, /No identifiable paying buyer/);
  assert.equal(result.hasVerifiedPayment, false);
});

test('missing buyer and offer become an explicit insufficient-evidence rejection', () => {
  const result = validateAssessment({ buyer: '', offer: null, test: 'Check real payment intent first', risk: 'A public comment is not a paid order', confidence: 90 });
  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.confidence, 10);
  assert.deepEqual(result.normalizedMissingFields, ['buyer', 'offer']);
  assert.equal(result.hasVerifiedPayment, false);
});
