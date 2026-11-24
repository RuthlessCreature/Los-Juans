import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MISSION, isSecureModelUrl, publicSnapshot, validateMissionPatch } from '../src/domain.mjs';

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

test('never transmit model credentials over HTTP', () => {
  assert.equal(isSecureModelUrl('http://example.com/v1'), false);
  assert.equal(isSecureModelUrl('https://example.com/v1'), true);
  assert.equal(isSecureModelUrl('https://user:pass@example.com/v1'), false);
});

test('public status never includes mission statement or secrets', () => {
  const status = publicSnapshot({ state: DEFAULT_MISSION, heartbeatCount: 3, eventCount: 4, latestHeartbeat: null });
  assert.equal(status.activity.heartbeatCount, 3);
  assert.equal(status.finance.verifiedRevenueCny, 0);
  assert.equal(JSON.stringify(status).includes(DEFAULT_MISSION.statement), false);
});
