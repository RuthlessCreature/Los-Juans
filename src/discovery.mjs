// Fixed read-only public source. No URL from a search result is ever fetched.
export const HN_FEED_URL = 'https://hn.algolia.com/api/v1/search_by_date?query=looking%20for&tags=comment&hitsPerPage=20';
const BUYER_WORDS = /\b(looking for|need a|need an|need someone|would pay|pay for|struggling with)\b/i;

function plainText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSignals(payload, now = Date.now()) {
  if (!Array.isArray(payload?.hits)) throw new TypeError('Unexpected public search response');
  const signals = [];
  for (const hit of payload.hits.slice(0, 20)) {
    const id = String(hit?.objectID ?? '');
    if (!/^\d{1,20}$/.test(id)) continue;
    const text = plainText(hit?.comment_text);
    const when = Number(hit?.created_at_i) * 1000;
    if (text.length < 50 || !BUYER_WORDS.test(text) || !Number.isFinite(when)) continue;
    if (when > now + 60_000 || now - when > 14 * 24 * 3600_000) continue;
    signals.push({
      title: `HN 公开需求线索 #${id}`,
      sourceUrl: `https://news.ycombinator.com/item?id=${id}`,
      buyerSignal: `公开评论片段（未经付费意愿核实）：${text.slice(0, 750)}`,
      hypothesis: '有用户表达具体需求，需人工或模型进一步核实购买意愿、预算和可交付服务。',
    });
    if (signals.length >= 4) break;
  }
  return signals;
}

export async function discoverPublicSignals({ fetcher = fetch, now = Date.now(), timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(HN_FEED_URL, {
      headers: { accept: 'application/json', 'user-agent': 'JuanResearchBot/0.2 (+public-read-only)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Public search returned HTTP ${response.status}`);
    const contentLength = Number(response.headers?.get('content-length') ?? 0);
    if (contentLength > 512_000) throw new Error('Public search response too large');
    const raw = await response.text();
    if (raw.length > 512_000) throw new Error('Public search response too large');
    return extractSignals(JSON.parse(raw), now);
  } finally {
    clearTimeout(timer);
  }
}
