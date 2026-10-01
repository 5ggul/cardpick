import { buildCardPriceDisplay, createJsonDeadline, UpstreamDataError, validateSummaryRows, validateTrustRows, CARD_PRICE_FIELDS } from '../_lib/card-price-display.js';

const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
const RANK = { normal: 1, holofoil: 2, reverseHolofoil: 3, unlimitedHolofoil: 4, '1stEditionHolofoil': 5, '1stEditionNormal': 6 };

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validNumber(value) {
  return value == null || ((typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)));
}

function validateCardmarket(rows) {
  if (rows.length > 1) throw new UpstreamDataError('upstream_invalid_data');
  for (const row of rows) {
    if (!record(row) || ['ext_avg_24h', 'ext_avg_7d', 'ext_avg_14d', 'ext_avg_30d', 'ext_change_7d_pct', 'ext_change_30d_pct'].some(key => !validNumber(row[key]))) {
      throw new UpstreamDataError('upstream_invalid_data');
    }
  }
  return rows[0] || null;
}

function withoutPrices(row) {
  return { ...row, ...Object.fromEntries(CARD_PRICE_FIELDS.map(key => [key, null])) };
}

export function createCardSummaryHandler({ fetchImpl = globalThis.fetch, timeoutMs = 4000, cache } = {}) {
  return async function onRequest(context) {
    const slug = new URL(context.request.url).searchParams.get('slug');
    if (!slug) return json({ error: 'slug required' }, 400);
    const edgeCache = cache === undefined ? globalThis.caches?.default : cache;
    const cacheKey = new Request(`https://cardpick.kr/__card_summary_v2_display_contract/${encodeURIComponent(slug)}`, { method: 'GET' });
    try {
      const hit = await edgeCache?.match(cacheKey);
      if (hit) return hit;
    } catch { /* Cache availability must not decide whether the card exists. */ }

    let deadline;
    try {
      deadline = createJsonDeadline({ fetchImpl, timeoutMs });
      const read = path => deadline.fetchJson(`${SUPA}/rest/v1/${path}`, { headers: { apikey: KEY } });
      const encoded = encodeURIComponent(slug);
      const cards = await read(`cards?select=slug,name,name_ko,game,set_code,set_name,number,rarity,rarity_class&slug=eq.${encoded}&game=eq.pokemon&limit=1`);
      // Only a successful, empty metadata query establishes that a card is absent.
      if (!cards.length) return json({ error: 'card not found' }, 404);
      if (cards.length !== 1 || !record(cards[0]) || cards[0].slug !== slug
          || cards[0].game !== 'pokemon' || typeof cards[0].name !== 'string' || !cards[0].name.trim()) {
        throw new UpstreamDataError('upstream_invalid_data');
      }

      const [variants, trustRows, cm] = await Promise.all([
        read(`card_price_summary?card_slug=eq.${encoded}&order=samples_30d.desc.nullslast`)
          .then(rows => validateSummaryRows(rows, slug)),
        read(`card_price_trust?card_slug=eq.${encoded}&select=trust_level,display_krw,distinct_7d,distinct_30d,clean_30d_n,clean_30d_median_krw&limit=1`)
          .then(validateTrustRows),
        // Optional EUR reference data never determines whether the card exists.
        read(`price_metrics_external?card_slug=eq.${encoded}&source=eq.pokemontcg-cardmarket&select=ext_avg_24h,ext_avg_7d,ext_avg_14d,ext_avg_30d,ext_change_7d_pct,ext_change_30d_pct,ext_updated_at`)
          .then(validateCardmarket).catch(() => null),
      ]);
      const source = variants.slice().sort((a, b) => (RANK[a.variant] || 9) - (RANK[b.variant] || 9))[0] || null;
      const trust = trustRows[0] || null;
      const display = buildCardPriceDisplay(source, trust);
      const best = source ? {
        ...(display.basis === 'unavailable' ? withoutPrices(source) : source),
        latest_krw: display.amountKrw,
        latest_usd: display.sourceUsd,
        trust_level: display.trustLevel,
        distinct_7d: trust?.distinct_7d ?? null,
        distinct_30d: trust?.distinct_30d ?? null,
        clean_30d_n: trust?.clean_30d_n ?? null,
        clean_30d_median_krw: display.basis === 'unavailable' ? null : (trust?.clean_30d_median_krw ?? null),
        price_display: display,
        // No unsupported exchange-rate assumptions or EUR-to-KRW conversion.
        usd_to_krw_rate: null,
        eur_to_krw_rate: null,
        latest_krw_cardmarket: null,
        cm_avg_7d_krw: null,
        cm_avg_14d_krw: null,
        cm_avg_30d_krw: null,
        cm_change_7d_pct: cm?.ext_change_7d_pct == null ? null : Number(cm.ext_change_7d_pct),
        cm_change_30d_pct: cm?.ext_change_30d_pct == null ? null : Number(cm.ext_change_30d_pct),
        cm_updated_at: cm?.ext_updated_at || null,
      } : null;
      const safeVariants = variants.map(row => display.basis === 'unavailable'
        ? withoutPrices(row) : (row === source ? { ...best } : { ...row }));
      const resp = json({ card: cards[0], best, variants: safeVariants, cardmarket: cm, price_display: display }, 200,
        'public, s-maxage=3600, stale-while-revalidate=600');
      if (edgeCache && typeof context.waitUntil === 'function') {
        context.waitUntil(Promise.resolve().then(() => edgeCache.put(cacheKey, resp.clone())).catch(() => {}));
      }
      return resp;
    } catch {
      return json({ error: 'Card data is temporarily unavailable.' }, 503);
    } finally {
      deadline?.close();
    }
  };
}

export const onRequest = createCardSummaryHandler();

function json(body, status = 200, cache = 'no-store, max-age=0') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
