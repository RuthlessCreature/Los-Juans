export const JUAN_VERSION = '0.3.0';
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

export function validateOpportunity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an opportunity object');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const sourceUrl = typeof value.sourceUrl === 'string' ? value.sourceUrl.trim() : '';
  const buyerSignal = typeof value.buyerSignal === 'string' ? value.buyerSignal.trim() : '';
  const hypothesis = typeof value.hypothesis === 'string' ? value.hypothesis.trim() : '';
  if (title.length < 5 || title.length > 180) throw new TypeError('Invalid opportunity title');
  if (!isSecureModelUrl(sourceUrl) || sourceUrl.length > 1800) throw new TypeError('Opportunity source must be HTTPS');
  if (buyerSignal.length < 10 || buyerSignal.length > 1600) throw new TypeError('Buyer evidence is required');
  if (hypothesis.length < 10 || hypothesis.length > 1600) throw new TypeError('Testable hypothesis is required');
  return { title, sourceUrl, buyerSignal, hypothesis };
}

export function validateAssessment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid model assessment');
  const result = {};
  const missingDefaults = {
    buyer: 'No identifiable paying buyer verified from this evidence.',
    offer: 'No credible paid offer identified from this evidence.',
    test: 'Find direct evidence of a buyer with a budget before further work.',
    risk: 'This public signal may be unrelated to a genuine purchase need.',
  };
  const missingFields = [];
  for (const key of ['buyer', 'offer', 'test', 'risk']) {
    if (typeof value[key] !== 'string' || value[key].trim().length < 8) {
      // Missing evidence is a negative finding, not a reason to invent customers or offers.
      result[key] = missingDefaults[key];
      missingFields.push(key);
      continue;
    }
    if (value[key].length > 1200) {
      throw new TypeError(`Missing or invalid assessment field: ${key}`);
    }
    result[key] = value[key].trim();
  }
  if (!Number.isInteger(value.confidence) || value.confidence < 0 || value.confidence > 100) {
    throw new TypeError('Assessment confidence must be 0–100');
  }
  result.confidence = missingFields.length ? Math.min(value.confidence, Math.max(0, 30 - missingFields.length * 10)) : value.confidence;
  result.buyerEvidenceMissing = missingFields.includes('buyer');
  result.insufficientEvidence = missingFields.length >= 2;
  result.normalizedMissingFields = missingFields;
  result.hasVerifiedPayment = false; // An LLM cannot certify payment.
  return result;
}

export function actionPolicy(kind) {
  const allowed = new Set(['read-public-web', 'analyze-evidence', 'draft-private-proposal']);
  const approval = new Set(['publish', 'contact-person', 'purchase', 'accept-contract', 'deploy-product']);
  if (allowed.has(kind)) return 'allowed-in-read-only-mode';
  if (approval.has(kind)) return 'requires-human-approval';
  return 'prohibited';
}

export function publicSnapshot({ state, discoveryCount = 0, latestDiscovery = null, eventCount, opportunityCount = 0, queuedTaskCount = 0 }) {
  return {
    name: JUAN_NAME,
    version: JUAN_VERSION,
    phase: 'read-only-research',
    mode: state.mode,
    autonomy: state.autonomy,
    safeguards: {
      externalSpending: false,
      outboundActions: false,
      autonomousModelCalls: state.modelCallsEnabled,
    },
    model: { provider: 'vllm', connection: state.modelCallsEnabled ? 'enabled-by-owner' : 'disabled-until-secure-endpoint' },
    goal: { firstVerifiedRevenueCny: state.firstRevenueTargetCny },
    finance: { verifiedRevenueCny: 0, newCashSpendCny: 0, modelAccountingCny: 0 },
    activity: { discoveryCount, latestDiscovery, eventCount, opportunityCount, queuedTaskCount },
  };
}
