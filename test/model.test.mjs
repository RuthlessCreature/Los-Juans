import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, completionUrl, ModelNotConfiguredError, parseAssessment, probeModel } from '../src/model.mjs';

test('model URL is HTTPS and OpenAI-compatible', () => {
  assert.equal(completionUrl('https://llm.example.com/v1'), 'https://llm.example.com/v1/chat/completions');
  assert.throws(() => completionUrl('http://llm.example.com/v1'), ModelNotConfiguredError);
  assert.equal(completionUrl('http://llm.example.com/v1', { allowInsecureHttp: true }), 'http://llm.example.com/v1/chat/completions');
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
  assert.equal(called[0].options.redirect, 'manual');
  assert.deepEqual(JSON.parse(called[0].options.body).response_format, { type: 'json_object' });
  assert.equal(JSON.parse(called[0].options.body).chat_template_kwargs.enable_thinking, false);
  assert.equal(result.usage.total_tokens, 7);
  assert.equal(result.content, 'OK');
});

test('model output cannot fabricate payment status', () => {
  const parsed = parseAssessment(JSON.stringify({ buyer: 'A group paying for a service', offer: 'A low-cost service trial', test: 'Request evidence of willingness to pay', risk: 'Potential platform policy violations', confidence: 65, hasVerifiedPayment: true }));
  assert.equal(parsed.hasVerifiedPayment, false);
  assert.throws(() => parseAssessment('{broken json'));
});

test('model probe checks only /models without sending a chat completion', async () => {
  let called;
  const result = await probeModel({
    baseUrl: 'http://llm.example.com/v1/chat/completions', apiKey: 'fake-test-key', allowInsecureHttp: true,
    fetcher: async (url, options) => { called = { url, options }; return { status: 200 }; },
  });
  assert.equal(called.url, 'http://llm.example.com/v1/models');
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.redirect, 'manual');
  assert.equal(result.reachable, true);
});
