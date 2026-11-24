import { isSecureModelUrl, validateAssessment } from './domain.mjs';

export class ModelNotConfiguredError extends Error {
  constructor(message = 'Secure vLLM endpoint and secret are not configured') {
    super(message);
    this.name = 'ModelNotConfiguredError';
  }
}

export function completionUrl(baseUrl, { allowInsecureHttp = false } = {}) {
  const explicitlyAllowedHttp = allowInsecureHttp
    && typeof baseUrl === 'string' && baseUrl.startsWith('http://')
    && isSecureModelUrl(`https://${baseUrl.slice('http://'.length)}`);
  if (!isSecureModelUrl(baseUrl) && !explicitlyAllowedHttp) {
    throw new ModelNotConfiguredError('Model endpoint must use HTTPS unless the owner explicitly enables HTTP');
  }
  const parsed = new URL(baseUrl);
  if (/\/v1\/?$/.test(parsed.pathname)) parsed.pathname = parsed.pathname.replace(/\/$/, '') + '/chat/completions';
  else if (!parsed.pathname.endsWith('/v1/chat/completions')) throw new ModelNotConfiguredError('Unexpected model API path');
  parsed.search = '';
  return parsed.toString();
}

export async function chatCompletion({ baseUrl, apiKey, model, messages, allowInsecureHttp = false, fetcher = fetch, timeoutMs = 90_000 }) {
  if (!apiKey || !model || !Array.isArray(messages) || !messages.length) throw new ModelNotConfiguredError();
  const endpoint = completionUrl(baseUrl, { allowInsecureHttp });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'manual', // Workers reject `error`; 3xx stays non-ok and is never followed.
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, messages, stream: false, temperature: 0.1, max_tokens: 1100,
        response_format: { type: 'json_object' },
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Model gateway returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Model returned no text');
    return { content, usage: payload.usage ?? null, model: payload.model ?? model };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeModel({ baseUrl, apiKey, allowInsecureHttp = false, fetcher = fetch, timeoutMs = 8000 }) {
  if (!apiKey) throw new ModelNotConfiguredError();
  const url = completionUrl(baseUrl, { allowInsecureHttp }).replace(/\/chat\/completions$/, '/models');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetcher(url, {
      method: 'GET', redirect: 'manual',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: controller.signal,
    });
    return { reachable: true, status: response.status, elapsedMs: Date.now() - start };
  } catch (error) {
    return { reachable: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network-error', elapsedMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

export function parseAssessment(content) {
  if (typeof content !== 'string') throw new TypeError('Model response is not text');
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (trimmed.length > 10_000) throw new TypeError('Model response is too long');
  return validateAssessment(JSON.parse(trimmed));
}
