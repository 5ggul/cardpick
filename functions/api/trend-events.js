// /api/trend-events
// Lightweight release/news candidate collector.
// It stores nothing and returns only public metadata: title, link, source, date.

const SOURCES = {
  jpInfo: 'https://www.pokemon-card.com/info/',
  pokeBeachFeed: 'https://www.pokebeach.com/feed/',
  eliteLatest: 'https://www.elitefourum.com/latest.json'
};

const KEYWORDS = [
  'pokemon', 'pokémon', 'tcg', 'card', 'cards', 'pack', 'set', 'promo',
  'release', 'announced', 'revealed', 'graded', 'psa', 'market',
  'ポケモン', 'カード', '発売', '商品', '拡張パック', '強化拡張パック', 'プロモ', 'イベント'
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 18), 1), 40);

  const startedAt = Date.now();
  const results = await Promise.allSettled([
    collectPokemonCardJp(),
    collectPokeBeach(),
    collectEliteFourum()
  ]);

  const items = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(String(r.reason && r.reason.message ? r.reason.message : r.reason).slice(0, 160));
  }

  const seen = new Set();
  const normalized = items
    .filter(item => item && item.title && item.url)
    .filter(item => {
      const key = normalizeKey(item.url || item.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(item => looksRelevant(item.title))
    .map(item => ({
      ...item,
      priority: scorePriority(item),
      collected_at: new Date().toISOString()
    }))
    .sort((a, b) => {
      const scoreDiff = b.priority - a.priority;
      if (scoreDiff) return scoreDiff;
      return timeValue(b.published_at) - timeValue(a.published_at);
    })
    .slice(0, limit);

  return json({
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    count: normalized.length,
    sources: Object.keys(SOURCES),
    errors,
    items: normalized
  }, 200, errors.length ? 900 : 1800);
}

async function collectPokemonCardJp() {
  const html = await fetchText(SOURCES.jpInfo, 6500);
  const items = [];
  const cardRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = cardRegex.exec(html)) && items.length < 30) {
    const href = absolutize(match[1], SOURCES.jpInfo);
    const title = cleanHtml(match[2]);
    if (!title || title.length < 6 || !looksRelevant(title)) continue;
    items.push({
      source: 'pokemon-card.com',
      source_type: 'official',
      title,
      url: href,
      published_at: extractDate(title) || null,
      kind: classify(title),
      country: 'JP'
    });
  }

  return items;
}

async function collectPokeBeach() {
  const xml = await fetchText(SOURCES.pokeBeachFeed, 6500);
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, 24).map(block => {
    const title = cleanXml(pickTag(block, 'title'));
    const link = cleanXml(pickTag(block, 'link'));
    const pubDate = cleanXml(pickTag(block, 'pubDate'));
    return {
      source: 'PokéBeach',
      source_type: 'news',
      title,
      url: link,
      published_at: pubDate ? new Date(pubDate).toISOString() : null,
      kind: classify(title),
      country: 'GLOBAL'
    };
  });
}

async function collectEliteFourum() {
  const json = await fetchJson(SOURCES.eliteLatest, 6500);
  const users = new Map((json.users || []).map(u => [u.id, u.username]));
  const topics = (json.topic_list && json.topic_list.topics) || [];
  return topics.slice(0, 35).map(topic => ({
    source: 'Elite Fourum',
    source_type: 'community',
    title: topic.title,
    url: `https://www.elitefourum.com/t/${topic.slug}/${topic.id}`,
    published_at: topic.last_posted_at || topic.created_at || null,
    kind: classify(topic.title),
    country: 'GLOBAL',
    replies: topic.posts_count ? Math.max(topic.posts_count - 1, 0) : 0,
    views: topic.views || 0,
    author: users.get(topic.posters && topic.posters[0] && topic.posters[0].user_id) || null
  }));
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'cardpick-trend-candidate/1.0 (+https://cardpick.kr)',
        'Accept': 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

function json(body, status = 200, edgeTtl = 1800) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=300, s-maxage=${edgeTtl}`,
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

function cleanHtml(value) {
  return cleanXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutize(href, base) {
  try { return new URL(href, base).toString(); }
  catch { return href; }
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function looksRelevant(title) {
  const t = String(title || '').toLowerCase();
  return KEYWORDS.some(k => t.includes(k.toLowerCase()));
}

function classify(title) {
  const t = String(title || '').toLowerCase();
  if (/psa|bgs|cgc|graded|grading|グレーディング/.test(t)) return 'grading';
  if (/market|price|sales|auction|시세|価格|相場/.test(t)) return 'market';
  if (/release|announc|revealed|発売|商品|拡張パック|強化拡張パック|予約/.test(t)) return 'release';
  if (/promo|プロモ|event|イベント|campaign|キャンペーン/.test(t)) return 'event';
  if (/card list|カードリスト|reveals|revealed/.test(t)) return 'card_list';
  return 'news';
}

function scorePriority(item) {
  let score = 0;
  if (item.source_type === 'official') score += 50;
  if (item.kind === 'release') score += 35;
  if (item.kind === 'card_list') score += 25;
  if (item.kind === 'event') score += 20;
  if (item.kind === 'grading' || item.kind === 'market') score += 15;
  if (item.views) score += Math.min(15, Math.floor(item.views / 250));
  if (item.replies) score += Math.min(10, Math.floor(item.replies / 5));
  const ageHours = (Date.now() - timeValue(item.published_at)) / 3600000;
  if (Number.isFinite(ageHours) && ageHours < 48) score += 10;
  return score;
}

function timeValue(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}

function extractDate(text) {
  const m = String(text || '').match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  return `${y}-${month}-${day}T00:00:00+09:00`;
}
