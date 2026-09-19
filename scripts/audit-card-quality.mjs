#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SUPA = 'https://aqxrmdratnkffvivguqs.supabase.co';
const KEY = 'sb_publishable_AeDBjfn3ymozGyw06ohMUw_S6n1-qpj';
const API = 'https://api.pokemontcg.io/v2';
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const outputDir = resolve(String(args.get('output') || 'artifacts/card-quality'));
const withSource = args.has('with-source');
const base = String(args.get('base') || 'https://cardpick.kr').replace(/\/$/, '');
const cacheFile = resolve('.cache/card-quality/source-cards.json');

const TYPE_KO = new Map([
  ['Grass', '풀'], ['Fire', '불꽃'], ['Water', '물'], ['Lightning', '번개'],
  ['Psychic', '초'], ['Fighting', '격투'], ['Darkness', '악'], ['Metal', '강철'],
  ['Dragon', '드래곤'], ['Fairy', '페어리'], ['Colorless', '무색']
]);

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}

async function getJson(url, options = {}, retries = 7) {
  let last;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt + 1 < retries) await new Promise((r) => setTimeout(r, Math.min(10000, 750 * (2 ** attempt))));
    }
  }
  throw last;
}

async function restAll(table, select) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${SUPA}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${table === 'cards' ? 'slug.asc' : 'card_slug.asc'}&limit=${pageSize}&offset=${offset}`;
    const page = await getJson(url, { headers: { apikey: KEY } });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function fetchCards() {
  const legacy = 'slug,external_id,name,name_ko,set_name,set_code,set_id,number,rarity,rarity_class,type,artist,is_indexable';
  try {
    return { rows: await restAll('cards', `${legacy},hp,supertype,subtypes`), metadataSchema: true };
  } catch (error) {
    if (!/hp|supertype|subtypes|column/i.test(error.message)) throw error;
    return { rows: await restAll('cards', legacy), metadataSchema: false };
  }
}

async function fetchSourceCards() {
  if (!withSource) return [];
  let checkpoint = { complete: false, nextPage: 1, cards: [] };
  if (!args.has('refresh-source-cache')) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (Array.isArray(cached)) return cached;
      if (cached.complete && Array.isArray(cached.cards)) return cached.cards;
      if (Array.isArray(cached.cards)) checkpoint = cached;
    } catch { /* fetch below */ }
  }
  const all = checkpoint.cards;
  await mkdir(dirname(cacheFile), { recursive: true });
  for (let page = checkpoint.nextPage; ; page += 1) {
    const params = new URLSearchParams({
      page: String(page), pageSize: '250',
      select: 'id,name,number,set,rarity,types,artist,hp,supertype,subtypes'
    });
    const payload = await getJson(`${API}/cards?${params}`);
    const rows = payload.data || [];
    all.push(...rows);
    process.stderr.write(`source cards: ${all.length}/${payload.totalCount || '?'}\r`);
    const complete = !rows.length || all.length >= Number(payload.totalCount || 0);
    await writeFile(cacheFile, JSON.stringify({ complete, nextPage: page + 1, cards: all }));
    if (complete) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  process.stderr.write('\n');
  return all;
}

async function sitemapPaths() {
  const response = await fetch(`${base}/sitemap-cards.xml`);
  if (!response.ok) throw new Error(`sitemap-cards.xml HTTP ${response.status}`);
  const xml = await response.text();
  return new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => new URL(m[1]).pathname));
}

function sourceKey(card) {
  return `${normalize(card.name)}|${normalize(card.number)}|${normalize(card.set?.id || card.set_id)}`;
}

function severityRank(level) {
  return ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, PASS: 0 })[level] || 0;
}

function evaluate(card, source, sitemap, trust, price) {
  const findings = [];
  const add = (severity, code, detail, action) => findings.push({ severity, code, detail, action });
  if (!card.name || !card.number || !card.set_name) add('HIGH', 'IDENTITY_INCOMPLETE', 'name, number, set_name 중 빈 값', '원천과 대조 후 식별 필드 보정');
  if (/-{2,}\d+-\d+$/.test(card.slug)) add('HIGH', 'MALFORMED_SLUG', card.slug, '기존 리디렉션 목록에 넣을 후보로 사람 검수');
  if (source) {
    if (normalize(card.name) !== normalize(source.name) || normalize(card.number) !== normalize(source.number)) {
      add('CRITICAL', 'SOURCE_IDENTITY_MISMATCH', `${source.name} #${source.number}`, '자동 수정 금지, 카드 ID를 사람 검수');
    }
    const sourceType = source.types?.[0] || '';
    if (sourceType && card.type && sourceType !== card.type) add('HIGH', 'TYPE_MISMATCH', `${card.type} != ${sourceType}`, '원천 타입으로 보정 후보');
    if (source.supertype === 'Pokémon' && source.hp && !card.hp) add('HIGH', 'HP_DROPPED', `source HP ${source.hp}`, 'v7 컬럼 적용 후 메타데이터 백필');
    if (source.supertype && !card.supertype) add('MEDIUM', 'SUPERTYPE_DROPPED', source.supertype, 'v7 컬럼 적용 후 메타데이터 백필');
  } else if (withSource) {
    add('HIGH', 'SOURCE_NOT_MATCHED', card.external_id || sourceKey(card), 'external_id와 세트 식별자를 사람 검수');
  }
  if (card.type && !TYPE_KO.has(card.type)) add('MEDIUM', 'UNKNOWN_TYPE', card.type, '공식 타입 매핑 검수');
  if (card.type === 'Psychic' && TYPE_KO.get(card.type) !== '초') add('CRITICAL', 'PSYCHIC_TRANSLATION', card.type, '표시명을 초로 수정');
  const hasTrustedPrice = !!price && !!trust && trust.trust_level !== 'NONE' && Number(trust.display_krw) > 0;
  const currentIndexable = hasTrustedPrice && ['HIGH', 'MEDIUM'].includes(trust.trust_level)
    && !!card.number && !!card.set_name && !/-{2,}\d+-\d+$/.test(card.slug)
    && (!!card.name_ko || Number(trust.display_krw) >= 5000);
  const inSitemap = sitemap.has(`/cards/${card.slug}`);
  if (inSitemap && !currentIndexable) add('HIGH', 'SITEMAP_GATE_MISMATCH', '사이트맵에는 있으나 현재 카드 색인 게이트는 통과하지 않음', '정책 변경 없이 원인만 검수');
  if (!findings.length) findings.push({ severity: 'PASS', code: 'PASS', detail: '', action: '유지' });
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return { findings, currentIndexable, inSitemap, hasTrustedPrice };
}

async function main() {
  const auditedAt = new Date().toISOString();
  const [{ rows: cards, metadataSchema }, trusts, prices, sitemap, sourceCards] = await Promise.all([
    fetchCards(),
    restAll('card_price_trust', 'card_slug,trust_level,display_krw,distinct_7d,distinct_30d'),
    restAll('card_price_summary_best', 'card_slug,latest_krw,last_fetched_at'),
    sitemapPaths(),
    fetchSourceCards()
  ]);
  const trustBySlug = new Map(trusts.map((x) => [x.card_slug, x]));
  const priceBySlug = new Map(prices.map((x) => [x.card_slug, x]));
  const sourceById = new Map(sourceCards.map((x) => [x.id, x]));
  const sourceByKey = new Map(sourceCards.map((x) => [sourceKey(x), x]));
  let sourceMatches = 0;
  const rows = cards.map((card) => {
    const source = sourceById.get(card.external_id) || sourceByKey.get(sourceKey(card));
    if (source) sourceMatches += 1;
    const result = evaluate(card, source, sitemap, trustBySlug.get(card.slug), priceBySlug.get(card.slug));
    const top = result.findings[0];
    return {
      slug: card.slug, external_id: card.external_id || '', name: card.name || '', name_ko: card.name_ko || '',
      set_name: card.set_name || '', set_id: card.set_id || '', number: card.number || '', rarity: card.rarity || '',
      db_type: card.type || '', db_hp: card.hp ?? '', db_supertype: card.supertype || '',
      source_id: source?.id || '', source_name: source?.name || '', source_number: source?.number || '',
      source_type: source?.types?.[0] || '', source_hp: source?.hp || '', source_supertype: source?.supertype || '',
      trust_level: trustBySlug.get(card.slug)?.trust_level || '', in_sitemap: result.inSitemap,
      current_index_gate: result.currentIndexable, severity: top.severity,
      issue_codes: result.findings.map((x) => x.code).join('|'),
      details: result.findings.filter((x) => x.detail).map((x) => `${x.code}: ${x.detail}`).join(' | '),
      recommended_action: [...new Set(result.findings.map((x) => x.action))].join(' | ')
    };
  });
  const counts = {};
  for (const row of rows) {
    counts[row.severity] = (counts[row.severity] || 0) + 1;
    for (const code of row.issue_codes.split('|')) counts[code] = (counts[code] || 0) + 1;
  }
  const columns = Object.keys(rows[0] || {});
  const csv = [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\n');
  const summary = `# Cardpick card quality dry-run\n\n` +
    `- Audited at: ${auditedAt}\n- Mode: read-only\n- Database cards: ${cards.length.toLocaleString()}\n` +
    `- Source comparison: ${withSource ? `${sourceCards.length.toLocaleString()} cards, ${sourceMatches.toLocaleString()} database rows matched` : 'not requested'}\n` +
    `- Metadata schema present: ${metadataSchema ? 'yes' : 'no'}\n- Card sitemap URLs: ${sitemap.size.toLocaleString()}\n` +
    `- Current index-gate candidates: ${rows.filter((x) => x.current_index_gate).length.toLocaleString()}\n\n` +
    `## Severity\n\n${['CRITICAL','HIGH','MEDIUM','LOW','PASS'].map((x) => `- ${x}: ${(counts[x] || 0).toLocaleString()}`).join('\n')}\n\n` +
    `## Finding codes\n\n${Object.entries(counts).filter(([k]) => !['CRITICAL','HIGH','MEDIUM','LOW','PASS'].includes(k)).sort((a,b) => b[1]-a[1]).map(([k,v]) => `- ${k}: ${v.toLocaleString()}`).join('\n')}\n\n` +
    `No robots, canonical, noindex, redirect, sitemap, database, or Search Console changes were made.\n`;
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDir, 'card-quality-audit.csv'), `\ufeff${csv}`),
    writeFile(resolve(outputDir, 'card-quality-summary.md'), summary),
    writeFile(resolve(outputDir, 'card-quality-summary.json'), JSON.stringify({ auditedAt, metadataSchema, sourceCards: sourceCards.length, sourceMatches, sitemapUrls: sitemap.size, databaseCards: cards.length, counts }, null, 2))
  ]);
  process.stdout.write(summary);
}

main().catch((error) => {
  process.stderr.write(`audit failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
