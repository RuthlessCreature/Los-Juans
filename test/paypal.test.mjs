import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PayPalNotConfiguredError, paypalReadiness, formatUsd, usdCents,
  createPayPalOrder, capturePayPalOrder, completedCapture, verifyPayPalWebhook,
} from '../src/paypal.mjs';

const env = {
  JUAN_PAYPAL_MODE: 'sandbox', JUAN_PAYPAL_CLIENT_ID: 'test-client',
  JUAN_PAYPAL_CLIENT_SECRET: 'test-secret', JUAN_PAYPAL_WEBHOOK_ID: 'WEBHOOK-TEST',
};
const id = 'a2bc9d12-1234-4444-8444-aa129b7332ff';

function mockFetch(responses) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const item = responses.shift();
    assert.ok(item, `No mocked response for ${url}`);
    return new Response(JSON.stringify(item.body), { status: item.status ?? 200 });
  };
  return { calls, fetcher };
}

const token = () => ({ body: { access_token: 'test-access-token' } });

test('checkout stays closed without three private credentials and explicit environment', async () => {
  assert.deepEqual(paypalReadiness({ ...env, JUAN_PAYPAL_MODE: 'unexpected' }), { mode: 'disabled', checkoutReady: false });
  assert.equal(paypalReadiness({ ...env, JUAN_PAYPAL_WEBHOOK_ID: '' }).checkoutReady, false);
  await assert.rejects(
    () => createPayPalOrder({ ...env, JUAN_PAYPAL_CLIENT_SECRET: '' }, { id, title: 'Test', priceUsdCents: 500 }),
    PayPalNotConfiguredError,
  );
});

test('USD amounts use exact integer cents; arbitrary decimals are invalid', () => {
  assert.equal(formatUsd(1299), '12.99');
  assert.equal(formatUsd(100), '1.00');
  assert.equal(usdCents('12.99'), 1299);
  for (const invalid of ['12.999', '12', '1e4', '-1.00', '01.00', 'NaN']) assert.equal(usdCents(invalid), null);
  assert.throws(() => formatUsd(-100), TypeError);
});

test('server creates a fixed-price PayPal order with a sandbox-only approval URL', async () => {
  const { calls, fetcher } = mockFetch([
    token(),
    { status: 201, body: { id: '9P99943869582473S', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=9P99943869582473S' }] } },
  ]);
  const created = await createPayPalOrder(env, {
    id, title: 'Paid market research brief', priceUsdCents: 2500,
    returnUrl: `https://juan.example/checkout/return?orderId=${id}`,
    cancelUrl: `https://juan.example/checkout/cancel?orderId=${id}`,
  }, fetcher);
  assert.equal(created.paypalOrderId, '9P99943869582473S');
  assert.equal(calls[0].url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(calls[1].init.headers['paypal-request-id'], `juan-create-${id}`);
  assert.equal(calls[1].init.headers.authorization, 'Bearer test-access-token');
  const request = JSON.parse(calls[1].init.body);
  assert.equal(request.intent, 'CAPTURE');
  assert.deepEqual(request.purchase_units[0].amount, { currency_code: 'USD', value: '25.00' });
  assert.equal(request.purchase_units[0].custom_id, id);
  assert.equal(request.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
});

test('malicious PayPal approval URL is rejected even in an otherwise successful API response', async () => {
  const { fetcher } = mockFetch([
    token(),
    { body: { id: '9P99943869582473S', links: [{ rel: 'approve', href: 'https://www.paypal.com.evil.invalid/fake' }] } },
  ]);
  await assert.rejects(() => createPayPalOrder(env, {
    id, title: 'Test product', priceUsdCents: 100,
    returnUrl: 'https://example.com/return', cancelUrl: 'https://example.com/cancel',
  }, fetcher), /unexpected origin/);
});

const captured = amount => ({
  status: 'COMPLETED', purchase_units: [{ payments: { captures: [{
    id: 'CAPTURE-123', status: 'COMPLETED', amount: { currency_code: 'USD', value: amount },
  }] } }],
});

test('order-level COMPLETED never implies payment; capture amount and status must match', () => {
  assert.deepEqual(completedCapture(captured('25.00'), 2500), { captureId: 'CAPTURE-123', capturedUsdCents: 2500 });
  assert.equal(completedCapture(captured('25.01'), 2500), null);
  assert.equal(completedCapture({ status: 'COMPLETED' }, 2500), null);
  const pending = captured('25.00');
  pending.purchase_units[0].payments.captures[0].status = 'PENDING';
  assert.equal(completedCapture(pending, 2500), null);
});

test('capture endpoint uses a stable PayPal idempotency key', async () => {
  const { calls, fetcher } = mockFetch([token(), { body: captured('25.00') }]);
  const result = await capturePayPalOrder(env, '9P99943869582473S', id, 2500, fetcher);
  assert.deepEqual(result.completed, { captureId: 'CAPTURE-123', capturedUsdCents: 2500 });
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/9P99943869582473S/capture');
  assert.equal(calls[1].init.headers['paypal-request-id'], `juan-capture-${id}`);
});

test('webhook signature verdict is fetched from PayPal, never inferred from the headers', async () => {
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert.pem',
    'paypal-transmission-id': 'transmission-1', 'paypal-transmission-sig': 'fake-signature',
    'paypal-transmission-time': '2026-11-24T00:00:00Z',
  });
  const event = { id: 'WH-12345678', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  const { calls, fetcher } = mockFetch([token(), { body: { verification_status: 'FAILURE' } }]);
  assert.equal(await verifyPayPalWebhook(env, headers, event, fetcher), false);
  assert.equal(calls[1].url, 'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.webhook_id, 'WEBHOOK-TEST');
  assert.equal(payload.transmission_id, 'transmission-1');
  assert.deepEqual(payload.webhook_event, event);
  await assert.rejects(() => verifyPayPalWebhook(env, new Headers(), event), /Missing PayPal webhook/);
});
