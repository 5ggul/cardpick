import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../methodology.html', import.meta.url), 'utf8');
const sql = readFileSync(new URL('./refresh_cold_pokemon.py', import.meta.url), 'utf8');
const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('observations are not sales, independent listings or cleaned row counts', () => {
  assert.match(text, /관측 표본은 실거래 건수나 독립 매물 수가 아닙니다/);
  assert.match(text, /가격이 같아도 수집 날짜가 달라지면 표본 수가 늘어납니다/);
  assert.match(text, /clean_n은 필터를 통과한 가격 행 수/);
  assert.match(sql, /group by card_slug, variant, d, source/);
  assert.match(sql, /count\(\*\)::int as clean_30d_n/);
});

test('trust explanation includes the first clean-count gate and does not invent a distinct minimum for LOW', () => {
  const section = html.split('<h2>4.')[1].split('<h2>5.')[0];
  assert.match(section, /clean_30d_n &lt; 5/);
  assert.match(section, /HIGH·MEDIUM 조건 미충족/);
  assert.doesNotMatch(section, /distinct_30d (?:<|&lt;|≥) 5/);
  assert.match(sql, /when coalesce\(cs.clean_30d_n, 0\) < 5 then 'NONE'/);
  assert.match(sql, /when c.distinct_30d >= 10 then 'MEDIUM'\s+else 'LOW'/);
});

test('ratio boundaries match the repository definition', () => {
  assert.match(text, /₩3,000 이상, ₩50,000 미만/);
  assert.match(text, /₩50,000 이상/);
  assert.match(html, /p_median &lt;= 0/);
  assert.match(sql, /when p_median < 3000 then abs\(p_new - p_median\) < 5000/);
  assert.match(sql, /when p_median < 50000 then p_new \/ p_median between 0.3 and 3.0/);
});

test('price sources, missing values and filter limitations are explicit', () => {
  assert.match(text, /TCGCSV로 수집한 TCGplayer/);
  assert.match(text, /Cardmarket EUR/);
  assert.match(text, /모든 가격 오류를 잡지는 못합니다/);
  assert.match(text, /유효한 display_krw가 없으면 참고가를 표시하지 않습니다/);
  assert.doesNotMatch(html, /₩152|자동 차단|재귀 오염|TCGplayer 단일 listing|무조건 NONE/);
});

test('metadata describes the visible article and retains its indexing policy', () => {
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.equal(schemas.length, 1);
  assert.equal(schemas[0]['@type'], 'TechArticle');
  assert.equal(schemas[0].dateModified, '2026-10-01');
  assert.match(html, /<time datetime="2026-10-01">2026-10-01<\/time>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/cardpick.kr\/methodology">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
});

test('long trust table scrolls in its own keyboard-accessible region', () => {
  assert.match(html, /\.table-scroll\{max-width:100%;overflow-x:auto\}/);
  assert.match(html, /class="table-scroll" role="region" aria-label="신뢰도 등급 비교표 \(가로 스크롤 가능\)" tabindex="0"/);
});
