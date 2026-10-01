// Shared presentation contract for card SSR and the summary API.
// This module does not decide search indexing or modify provider objects.
const TRUST_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW']);
export const CARD_PRICE_FIELDS = [
  'latest_krw', 'latest_usd', 'median_7d', 'median_14d', 'median_30d',
  'avg_7d', 'avg_14d', 'avg_30d', 'price_low_usd', 'price_high_usd',
  'change_1d_pct', 'change_7d_pct', 'change_14d_pct', 'change_30d_pct',
];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function number(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function count(value) {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function observedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const calendarDate = value.slice(0, 10);
  const day = new Date(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendarDate) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function buildCardPriceDisplay(summary, trust) {
  const sourceDate = record(summary) ? observedAt(summary.last_fetched_at) : null;
  const level = record(trust) ? trust.trust_level : null;
  const candidate = record(trust) ? positive(trust.display_krw) : null;
  const amount = candidate === null ? null : Math.round(candidate);
  const valid = record(summary) && TRUST_LEVELS.has(level)
    && amount !== null && Number.isSafeInteger(amount) && amount > 0;
  const d7 = record(trust) ? count(trust.distinct_7d) : null;
  const d30 = record(trust) ? count(trust.distinct_30d) : null;
  const samplesText = [
    d7 !== null ? `최근 7일 관측 표본 ${d7}건` : '',
    d30 !== null ? `30일 ${d30}건` : '',
  ].filter(Boolean).join(' · ') || '검증 표본 수 확인 불가';
  const unavailableText = '검증된 가격 데이터가 없어 참고가를 표시하지 않습니다.';

  if (!valid) {
    return {
      amountKrw: null,
      trustLevel: 'NONE',
      basis: 'unavailable',
      label: '해외 참고가',
      priceText: '—',
      secondaryText: unavailableText,
      trustText: '참고가 산출 불가',
      basisText: '가격 산출 기준 확인 불가',
      samplesText,
      sourceUsd: null,
      sourceDate,
      sourceDescription: 'TCGplayer 북미 가격 자료. 국내 실거래가가 아닙니다.',
      unavailableText,
      reviewedPriceText: '현재 신뢰할 수 있는 참고가가 없습니다. 가격 대신 카드 식별 정보를 확인하세요.',
    };
  }

  const median = level === 'MEDIUM' || level === 'LOW';
  const originalKrw = positive(summary.latest_krw);
  const originalUsd = positive(summary.latest_usd);
  // Only pair USD with a HIGH display amount from the same unmodified snapshot.
  // A median, or a mismatched source price, must never masquerade as FX conversion.
  const sourceUsd = !median && originalKrw !== null && originalUsd !== null
    && Math.abs(originalKrw - amount) <= 0.5 ? originalUsd : null;
  const secondaryText = median
    ? `이상치를 제외한 최근 30일 중앙값 · 국내 거래가와 다를 수 있습니다.${level === 'LOW' ? ' 표본이 적어 참고용으로만 확인하세요.' : ''}`
    : `${sourceUsd !== null ? `$${sourceUsd.toFixed(2)} · ` : ''}TCGplayer 북미 기준 해외 참고가 · 국내 거래가와 다를 수 있습니다.`;
  let reviewedPriceText = `표시 참고가는 ₩${amount.toLocaleString('ko-KR')}이며, ${median
    ? '이상치를 제외한 30일 중앙값입니다.'
    : '현재 표본·이상치 검증을 통과한 해외 기준 가격입니다.'}`;
  const median7 = positive(summary.median_7d);
  const gap = median7 !== null ? ((median7 - amount) / amount) * 100 : null;
  if (gap !== null && Number.isFinite(gap)) {
    reviewedPriceText += Math.abs(gap) < 1
      ? ' 7일 중앙값과 표시 참고가의 차이가 1% 미만입니다.'
      : ` 7일 중앙값은 이 기준보다 ${Math.abs(gap).toFixed(1)}% ${gap > 0 ? '높습니다' : '낮습니다'}.`;
  }
  return {
    amountKrw: amount,
    trustLevel: level,
    basis: median ? 'median30d' : 'latest',
    label: median ? '최근 30일 중앙값 참고가' : '해외 참고가',
    priceText: `₩ ${amount.toLocaleString('ko-KR')}`,
    secondaryText,
    trustText: { HIGH: '신뢰도 높음', MEDIUM: '신뢰도 중간 · 30일 중앙값', LOW: '신뢰도 낮음 · 표본 부족' }[level],
    basisText: `${median ? '이상치를 제외한 30일 중앙값' : '최근 가격의 표본·이상치 검증 통과'}. 관측 표본은 실제 판매 건수가 아닙니다.`,
    samplesText,
    sourceUsd,
    sourceDate,
    sourceDescription: median
      ? 'TCGplayer 북미 가격 자료에서 이상치를 제외한 30일 원화 중앙값입니다.'
      : 'TCGplayer 북미 market price 기반 원화 참고가입니다.',
    unavailableText: '',
    reviewedPriceText,
  };
}

export class UpstreamDataError extends Error {
  constructor(reason, status = null) {
    super(reason);
    this.name = 'UpstreamDataError';
    this.reason = reason;
    this.status = status;
  }
}

function validOptionalNumber(value) {
  return value == null || ((typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)));
}

export function validateSummaryRows(rows, slug) {
  if (!Array.isArray(rows)) throw new UpstreamDataError('upstream_invalid_data');
  for (const row of rows) {
    if (!record(row) || row.card_slug !== slug || typeof row.variant !== 'string'
        || !row.variant.trim() || !Object.hasOwn(row, 'latest_krw') || !Object.hasOwn(row, 'latest_usd')
        || CARD_PRICE_FIELDS.some(key => !validOptionalNumber(row[key]))) {
      throw new UpstreamDataError('upstream_invalid_data');
    }
  }
  return rows;
}

export function validateTrustRows(rows) {
  if (!Array.isArray(rows) || rows.length > 1) throw new UpstreamDataError('upstream_invalid_data');
  for (const row of rows) {
    if (!record(row) || !['HIGH', 'MEDIUM', 'LOW', 'NONE'].includes(row.trust_level)
        || !Object.hasOwn(row, 'display_krw') || !validOptionalNumber(row.display_krw)
        || ['distinct_7d', 'distinct_30d', 'clean_30d_n', 'clean_30d_median_krw'].some(key => !validOptionalNumber(row[key]))) {
      throw new UpstreamDataError('upstream_invalid_data');
    }
  }
  return rows;
}

// One request-scoped deadline, shared by all REST reads including body parsing.
export function createJsonDeadline({ fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UpstreamDataError('invalid_timeout');
  const controller = new AbortController();
  let closed = false;
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new UpstreamDataError('upstream_timeout'));
      controller.abort();
    }, Math.min(timeoutMs, 4000));
  });
  // A caller may abandon a deadline before its first read (for example a cache
  // hit). Keep the shared rejection handled; each fetchJson still races it.
  expired.catch(() => {});

  return {
    async fetchJson(url, options = {}) {
      if (closed) throw new UpstreamDataError('request_closed');
      const load = async () => {
        let response;
        try {
          response = await fetchImpl(url, { ...options, signal: controller.signal });
        } catch {
          throw new UpstreamDataError('upstream_network_error');
        }
        if (!response?.ok) throw new UpstreamDataError('upstream_http_error', response?.status ?? null);
        let data;
        try {
          data = await response.json();
        } catch {
          throw new UpstreamDataError('upstream_invalid_json');
        }
        if (!Array.isArray(data)) throw new UpstreamDataError('upstream_invalid_data');
        return data;
      };
      return Promise.race([load(), expired]);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
