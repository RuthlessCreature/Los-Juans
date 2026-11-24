export const JUAN_VERSION = '0.1.0';
export const JUAN_NAME = 'Juan';

export const DEFAULT_MISSION = Object.freeze({
  statement: '在合法、授权和预算约束内，自主寻找真实付费需求，低成本验证机会，并以实际到账收入为目标。',
  autonomy: 'bounded',
  mode: 'safe-mode',
  outboundActionsEnabled: false,
  modelCallsEnabled: false,
  newCashSpendLimitCny: 0,
  modelAccountingCny: 0,
  firstRevenueTargetCny: 1,
});

export function validateMissionPatch(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('Expected a mission object');
  }
  const allowed = new Set(['statement', 'firstRevenueTargetCny']);
  const patch = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!allowed.has(key)) throw new TypeError(`Field ${key} is not editable`);
    if (key === 'statement') {
      if (typeof value !== 'string' || !value.trim() || value.length > 800) throw new TypeError('Invalid mission statement');
      patch.statement = value.trim();
    }
    if (key === 'firstRevenueTargetCny') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new TypeError('Invalid revenue target');
      patch.firstRevenueTargetCny = value;
    }
  }
  return patch;
}

export function isSecureModelUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && !url.hash;
  } catch {
    return false;
  }
}

export function publicSnapshot({ state, heartbeatCount, latestHeartbeat, eventCount }) {
  return {
    name: JUAN_NAME,
    version: JUAN_VERSION,
    phase: 'infrastructure',
    mode: state.mode,
    autonomy: state.autonomy,
    safeguards: {
      externalSpending: false,
      outboundActions: false,
      autonomousModelCalls: false,
    },
    model: { provider: 'vllm', connection: 'disabled-until-secure-endpoint' },
    goal: { firstVerifiedRevenueCny: state.firstRevenueTargetCny },
    finance: { verifiedRevenueCny: 0, newCashSpendCny: 0, modelAccountingCny: 0 },
    activity: { heartbeatCount, latestHeartbeat, eventCount },
  };
}
