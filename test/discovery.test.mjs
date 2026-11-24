import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverPublicSignals, extractSignals, HN_FEED_URL } from '../src/discovery.mjs';

const NOW = Date.parse('2026-11-24T00:00:00Z');

test('turn only recent evidence-bearing public comments into unverified leads', () => {
  const payload = { hits: [
    { objectID: '123456', comment_text: '<p>I am looking for someone to make a simple PDF export tool for our operations. Our team still does this manually every week.</p>', created_at_i: NOW / 1000 },
    { objectID: '123457', comment_text: 'This is another interesting thing with a lot of words and nothing about a problem or buyer intent.', created_at_i: NOW / 1000 },
    { objectID: 'abc', comment_text: 'Looking for a very good tool that handles these operations quickly and with care over time.', created_at_i: NOW / 1000 },
  ] };
  const signals = extractSignals(payload, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].sourceUrl, 'https://news.ycombinator.com/item?id=123456');
  assert.match(signals[0].buyerSignal, /未经付费意愿核实/);
  assert.doesNotMatch(signals[0].buyerSignal, /<p>/);
});

test('discovery uses a fixed origin and does not follow links in untrusted hits', async () => {
  let requestedUrl;
  const out = await discoverPublicSignals({ now: NOW, fetcher: async (url) => {
    requestedUrl = url;
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ hits: [{ objectID: '7788', comment_text: 'We need someone to create a tool; external link: http://127.0.0.1/admin and a long enough description for matching.', created_at_i: NOW / 1000 }] }) };
  } });
  assert.equal(requestedUrl, HN_FEED_URL);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceUrl, 'https://news.ycombinator.com/item?id=7788');
});

test('malformed source payload fails instead of manufacturing opportunities', () => {
  assert.throws(() => extractSignals({}, NOW));
});
