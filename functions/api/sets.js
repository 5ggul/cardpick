// Third-party set data, kept separate from the verified release calendar.
import setsSnapshot from '../../data/pokemon-sets-snapshot.json' with { type: 'json' };

const UPSTREAM_URL = 'https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=80';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

class UpstreamFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid text');
  return value.trim();
}

function optionalText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid optional text');
  return value;
}

function optionalCount(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid card count');
  return value;
}

function httpsUrl(value) {
  const text = requiredText(value);
  const url = new URL(text);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Invalid source URL');
  }
  return text;
}

function releaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}([/-])\d{2}\1\d{2}$/.test(value)) {
    throw new Error('Invalid release date');
  }
  const iso = value.replace(/\//g, '-');
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (iso.slice(0, 4) === '0000' || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error('Invalid calendar date');
  }
  return iso;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Invalid source timestamp');
  }
  releaseDate(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid source timestamp');
  return value;
}

function normalizeSets(rawSets, today) {
  if (!Array.isArray(rawSets) || rawSets.length === 0) throw new Error('Empty or malformed set data');
  const byId = new Map();
  for (const raw of rawSets) {
    if (!isObject(raw)) throw new Error('Invalid set object');
    const id = requiredText(raw.id);
    const name = requiredText(raw.name);
    const date = releaseDate(raw.releaseDate);
    optionalText(raw.updatedAt); // Provider field is not a collection-wide freshness date.
    let symbol = null;
    if (raw.images !== undefined && raw.images !== null) {
      if (!isObject(raw.images)) throw new Error('Invalid images object');
      for (const field of ['symbol', 'logo']) {
        if (raw.images[field] !== undefined && raw.images[field] !== null) {
          httpsUrl(raw.images[field]);
        }
      }
      symbol = raw.images.symbol ?? null;
    }
    const set = {
      id,
      name,
      series: optionalText(raw.series),
      release_date: date,
      printed_total: optionalCount(raw.printedTotal),
      total: optionalCount(raw.total),
      symbol_url: symbol,
      ptcgo_code: optionalText(raw.ptcgoCode),
      is_upcoming: date >= today,
    };
    if (byId.has(id) && JSON.stringify(byId.get(id)) !== JSON.stringify(set)) {
      throw new Error('Conflicting duplicate set ID');
    }
    // Same-day products are distinct; only identical IDs/data are deduplicated.
    byId.set(id, set);
  }
  return [...byId.values()];
}

function snapshotData(snapshot, today) {
  if (!isObject(snapshot) || !isObject(snapshot.source)) throw new Error('Invalid snapshot');
  const metadata = snapshot.source;
  const revision = requiredText(metadata.revision);
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('Invalid snapshot revision');
  const sourceUrl = httpsUrl(metadata.url);
  const parsed = new URL(sourceUrl);
  if (parsed.hostname !== 'github.com'
      || parsed.pathname !== `/PokemonTCG/pokemon-tcg-data/blob/${revision}/sets/en.json`
      || parsed.search || parsed.hash) {
    throw new Error('Snapshot source must identify its immutable provider revision');
  }
  const source = {
    kind: 'snapshot',
    name: requiredText(metadata.name),
    url: sourceUrl,
    updated_at: timestamp(metadata.updated_at),
    revision,
  };
  timestamp(metadata.retrieved_at);
  return { sets: normalizeSets(snapshot.data, today), source };
}

async function requestSets(fetchImpl, today, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new UpstreamFailure('upstream_timeout'));
      controller.abort();
    }, timeoutMs);
  });
  const load = async () => {
    let response;
    try {
      response = await fetchImpl(UPSTREAM_URL, {
        headers: { 'User-Agent': 'cardpick/1.0' },
        signal: controller.signal,
      });
    } catch {
      throw new UpstreamFailure('upstream_network_error');
    }
    if (!response || !response.ok) throw new UpstreamFailure('upstream_http_error');
    let body;
    try {
      body = await response.json();
    } catch {
      throw new UpstreamFailure('upstream_invalid_json');
    }
    try {
      if (!isObject(body)) throw new Error('Invalid response');
      return normalizeSets(body.data, today);
    } catch {
      throw new UpstreamFailure('upstream_invalid_data');
    }
  };
  try {
    // The same deadline covers headers and body parsing, not just fetch().
    return await Promise.race([load(), expired]);
  } finally {
    clearTimeout(timeout);
  }
}

function responseBody(sets, today) {
  const tieBreak = (a, b) => a.id.localeCompare(b.id);
  const upcoming = sets.filter(set => set.is_upcoming)
    .sort((a, b) => a.release_date.localeCompare(b.release_date) || tieBreak(a, b));
  const past = sets.filter(set => !set.is_upcoming)
    .sort((a, b) => b.release_date.localeCompare(a.release_date) || tieBreak(a, b));
  return { today, upcoming, recent: past.slice(0, 12), archive: past.slice(12, 60), total: sets.length };
}

export function createSetsHandler({
  fetchImpl = globalThis.fetch,
  snapshot = setsSnapshot,
  now = () => new Date(),
  timeoutMs = 4000,
} = {}) {
  return async function onRequest() {
    try {
      const requestTime = now();
      if (!(requestTime instanceof Date) || !Number.isFinite(requestTime.getTime())) throw new Error('Invalid clock');
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout');
      const today = new Date(requestTime.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
      let sets;
      let source = { kind: 'api', name: 'Pokémon TCG API', url: UPSTREAM_URL, updated_at: null };
      let fallbackReason;
      try {
        sets = await requestSets(fetchImpl, today, Math.min(timeoutMs, 4000));
      } catch (error) {
        fallbackReason = error instanceof UpstreamFailure ? error.reason : 'upstream_network_error';
        ({ sets, source } = snapshotData(snapshot, today));
      }
      const body = {
        ...responseBody(sets, today),
        fallback: source.kind === 'snapshot',
        source,
        fetched_at: requestTime.toISOString(),
      };
      if (fallbackReason) body.fallback_reason = fallbackReason;
      return json(body);
    } catch {
      // Never expose upstream response text, exception messages, or secrets.
      return json({ error: 'Set data is temporarily unavailable.' }, 503);
    }
  };
}

export const onRequest = createSetsHandler();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
