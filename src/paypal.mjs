// Server-side PayPal Orders v2 adapter. No credentials or buyer data go to the browser.
export class PayPalNotConfiguredError extends Error {}
export class PayPalApiError extends Error {
  constructor(status) {
    super(`PayPal API request failed (HTTP ${status})`);
    this.status = status;
  }
}

const HOSTS = Object.freeze({
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
});
const APPROVAL_HOSTS = Object.freeze({
  sandbox: 'www.sandbox.paypal.com',
  live: 'www.paypal.com',
});

export function paypalReadiness(env) {
  const mode = env.JUAN_PAYPAL_MODE;
  const enabled = (mode === 'sandbox' || mode === 'live')
    && Boolean(env.JUAN_PAYPAL_CLIENT_ID && env.JUAN_PAYPAL_CLIENT_SECRET && env.JUAN_PAYPAL_WEBHOOK_ID);
  return { mode: mode === 'live' || mode === 'sandbox' ? mode : 'disabled', checkoutReady: enabled };
}

function configuration(env) {
  const readiness = paypalReadiness(env);
  if (!readiness.checkoutReady) throw new PayPalNotConfiguredError('PayPal checkout is not configured');
  return { mode: readiness.mode, base: HOSTS[readiness.mode] };
}

export function formatUsd(cents) {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) throw new TypeError('Invalid USD cents amount');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function usdCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(value)) return null;
  const [dollars, cents] = value.split('.');
  const amount = Number(dollars) * 100 + Number(cents);
  return Number.isSafeInteger(amount) ? amount : null;
}

async function paypalFetch(url, init, fetcher) {
  const response = await fetcher(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  // Do not echo the response text: PayPal errors can contain account details.
  const raw = await response.text();
  if (raw.length > 131072) throw new Error('PayPal response exceeded size limit');
  if (!response.ok) throw new PayPalApiError(response.status);
  try { return JSON.parse(raw); } catch { throw new Error('PayPal returned invalid JSON'); }
}

async function accessToken(env, fetcher = fetch) {
  const { base } = configuration(env);
  const auth = btoa(`${env.JUAN_PAYPAL_CLIENT_ID}:${env.JUAN_PAYPAL_CLIENT_SECRET}`);
  const result = await paypalFetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }, fetcher);
  if (typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 4096) {
    throw new Error('PayPal token response is invalid');
  }
  return result.access_token;
}

async function api(env, path, { method = 'GET', payload, requestId } = {}, fetcher = fetch) {
  const { base } = configuration(env);
  const token = await accessToken(env, fetcher);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (requestId) headers['paypal-request-id'] = requestId;
  return paypalFetch(`${base}${path}`, {
    method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, fetcher);
}

export async function createPayPalOrder(env, { id, title, priceUsdCents, returnUrl, cancelUrl }, fetcher = fetch) {
  const { mode } = configuration(env);
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: id, custom_id: id, description: title,
      amount: { currency_code: 'USD', value: formatUsd(priceUsdCents) },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: 'Juan', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
      return_url: returnUrl, cancel_url: cancelUrl,
    } } },
  };
  const result = await api(env, '/v2/checkout/orders', { method: 'POST', payload, requestId: `juan-create-${id}` }, fetcher);
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9-]{8,32}$/.test(result.id)) {
    throw new Error('PayPal order ID is invalid');
  }
  const link = result.links?.find(item => item.rel === 'payer-action' || item.rel === 'approve')?.href;
  let url;
  try { url = new URL(link); } catch { throw new Error('PayPal approval link is missing'); }
  if (url.protocol !== 'https:' || url.hostname !== APPROVAL_HOSTS[mode] || url.username || url.password) {
    throw new Error('PayPal approval link has an unexpected origin');
  }
  return { paypalOrderId: result.id, approvalUrl: url.toString() };
}

export function completedCapture(result, expectedCents) {
  if (!result || typeof result !== 'object') return null;
  const captures = result.purchase_units?.flatMap(unit => unit.payments?.captures ?? []) ?? [];
  if (captures.length !== 1) return null;
  const capture = captures[0];
  if (capture.status !== 'COMPLETED' || capture.amount?.currency_code !== 'USD'
    || usdCents(capture.amount?.value) !== expectedCents || typeof capture.id !== 'string' || !capture.id) return null;
  return { captureId: capture.id, capturedUsdCents: expectedCents };
}

export async function capturePayPalOrder(env, paypalOrderId, id, priceUsdCents, fetcher = fetch) {
  if (!/^[A-Za-z0-9-]{8,32}$/.test(paypalOrderId)) throw new TypeError('Invalid PayPal order ID');
  const result = await api(env, `/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST', payload: {}, requestId: `juan-capture-${id}`,
  }, fetcher);
  return { status: result.status, completed: completedCapture(result, priceUsdCents) };
}

export async function verifyPayPalWebhook(env, headers, event, fetcher = fetch) {
  configuration(env);
  const fields = {
    auth_algo: 'paypal-auth-algo', cert_url: 'paypal-cert-url',
    transmission_id: 'paypal-transmission-id', transmission_sig: 'paypal-transmission-sig',
    transmission_time: 'paypal-transmission-time',
  };
  const payload = { webhook_id: env.JUAN_PAYPAL_WEBHOOK_ID, webhook_event: event };
  for (const [key, header] of Object.entries(fields)) {
    const value = headers.get(header);
    if (typeof value !== 'string' || !value || value.length > 4096) throw new TypeError('Missing PayPal webhook signature header');
    payload[key] = value;
  }
  const result = await api(env, '/v1/notifications/verify-webhook-signature', { method: 'POST', payload }, fetcher);
  return result.verification_status === 'SUCCESS';
}
