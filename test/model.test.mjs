import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, completionUrl, ModelNotConfiguredError, parseAssessment } from '../src/model.mjs';

test('model URL is HTTPS and OpenAI-compatible', () => {
  assert.equal(completionUrl('https://llm.example.com/v1'), 'https://llm.example.com/v1/chat/completions');
  assert.throws(() => completionUrl('http://llm.example.com/v1'), ModelNotConfiguredError);
  assert.throws(() => completionUrl('https://llm.example.com/unknown'), ModelNotConfiguredError);
});

test('model adapter uses secure authenticated requests', async () => {
  const called = [];
  const result = await chatCompletion({
    baseUrl: 'https://llm.example.com/v1', apiKey: 'fake-test-key', model: 'Qwen',
    messages: [{ role: 'user', content: 'Hello' }],
    fetcher: async (url, options) => {
      called.push({ url, options });
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 7 } }) };
    },
  });
  assert.equal(called[0].url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(called[0].options.headers.authorization, 'Bearer fake-test-key');
  assert.equal(called[0].options.redirect, 'error');
  assert.equal(result.usage.total_tokens, 7);
  assert.equal(result.content, 'OK');
});

test('model output cannot fabricate payment status', () => {
  const parsed = parseAssessment(JSON.stringify({ buyer: 'A group paying for a service', offer: 'A low-cost service trial', test: 'Request evidence of willingness to pay', risk: 'Potential platform policy violations', confidence: 65, hasVerifiedPayment: true }));
  assert.equal(parsed.hasVerifiedPayment, false);
  assert.throws(() => parseAssessment('{broken json'));
});
