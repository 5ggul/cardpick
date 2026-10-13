// Local source contracts only. Immutable 53d5e4f baselines are restored using
// exact approved strings, never by stripping arbitrary head/body/style blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/guides.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const psa = read('guide-psa-grading-korea.html');
const about = read('about.html');
const releases = read('releases.html');
const hub = await (await onRequest()).text();
const description = '포켓몬 카드 PSA 그레이딩 한국 신청 방법 가이드. 비용 항목, 직접 접수·대행 선택, 포장·배송 전 확인 사항을 정리합니다.';
const psaCss = '  /* Page-owned header touch targets and keyboard focus. */\n'
  + '  header > div > a,header nav a{display:inline-flex;align-items:center;min-height:44px}\n'
  + '  header a:focus-visible{outline:2px solid #26E0C2;outline-offset:2px}\n';
const aboutCss = '  /* Page-owned header touch targets and keyboard focus. */\n'
  + '  header > div > a,header .page-nav a{display:inline-flex;align-items:center;min-height:44px}\n'
  + '  header a:focus-visible{outline:2px solid #26E0C2;outline-offset:2px}\n'
  + '  .trust-table-scroll{max-width:100%;overflow-x:auto}\n'
  + '  .trust-table-scroll:focus-visible{outline:2px solid #26E0C2;outline-offset:2px}\n'
  + '  @media(max-width:720px){header > div{padding-left:16px;padding-right:16px;gap:8px}header > div > a{margin-right:0}.page-nav{gap:12px}}\n';
const cpCss = '/* Page-owned header touch targets and keyboard focus. */\n'
  + '.cp-topbar .cp-brand,.cp-topbar .cp-nav a{display:inline-flex;align-items:center;min-height:44px}\n'
  + '.cp-topbar .cp-search{min-height:44px}\n'
  + '.cp-topbar .cp-login-google{height:auto;min-height:44px}\n'
  + '.cp-topbar a:focus-visible,.cp-topbar button:focus-visible,.cp-topbar input:focus-visible{outline:2px solid #26E0C2;outline-offset:2px}\n';

const psaPairs = [
  [`<meta name="description" content="${description}">`, '<meta name="description" content="포켓몬 카드 PSA 그레이딩 한국 신청 방법 가이드. 비용·기간·필요 서류·대행 업체·BRG10 비교·실수 방지 팁. 처음 보내는 분도 한 번에 흐름 잡을 수 있습니다.">'],
  [`<meta property="og:description" content="${description}">`, '<meta property="og:description" content="비용·기간·신청 단계·BRG10 비교·실수 방지. 한국에서 PSA로 카드 보내는 가이드.">'],
  [`<meta name="twitter:description" content="${description}">`, '<meta name="twitter:description" content="비용·기간·신청 단계·BRG10 비교·실수 방지. 한국에서 PSA로 카드 보내는 가이드.">'],
  [`  "description": "${description}",`, '  "description": "포켓몬 카드 PSA 그레이딩 한국 신청 방법 가이드. 비용·기간·필요 서류·대행 업체·BRG10 비교·실수 방지 팁.",'],
  ['<a href="/tools/grading-cost-compare">PSA·BGS·CGC·SGC 그레이딩 비용 비교 계산기</a>', '<a href="/tools/grading-cost-compare">PSA BGS BRG 그레이딩 비용 계산기 : 4사 비용·대행 비교</a>'],
  ['  "keywords": "PSA 그레이딩, PSA 신청, PSA 대행, PSA 한국, 포켓몬 카드 PSA, PSA 10, PSA 9, BGS, 카드 그레이딩, 카드 등급, EMS 발송, PSA 비용, PSA 기간, Card Saver"', '  "keywords": "PSA 그레이딩, PSA 신청, PSA 대행, PSA 한국, 포켓몬 카드 PSA, PSA 10, PSA 9, BGS, BRG10, 카드 그레이딩, 카드 등급, EMS 발송, PSA 비용, PSA 기간, Card Saver"'],
];
const oldTable = '  <table>\n'
  + '    <thead>\n'
  + '      <tr><th>등급</th><th>조건</th><th>표시</th></tr>\n'
  + '    </thead>\n'
  + '    <tbody>\n'
  + '      <tr><td><strong style="color:#26E0C2">HIGH</strong></td><td>distinct 7일 5건+ AND ratio gate 통과</td><td>최신 가격</td></tr>\n'
  + '      <tr><td><strong>MEDIUM</strong></td><td>distinct 30일 10건+</td><td>30일 중앙값</td></tr>\n'
  + '      <tr><td><strong style="color:#E0B84A">LOW</strong></td><td>distinct 30일 5건+</td><td>중앙값 + ⚠ 경고</td></tr>\n'
  + '      <tr><td><strong style="color:#FF4D6D">NONE</strong></td><td>distinct 30일 < 5</td><td>"참고가 산출 불가"</td></tr>\n'
  + '    </tbody>\n'
  + '  </table>';
const newTable = '  <div class="trust-table-scroll" role="region" aria-label="신뢰도 등급 비교표 (가로 스크롤 가능)" tabindex="0">\n'
  + '  <table>\n'
  + '    <thead>\n'
  + '      <tr><th>등급</th><th>조건</th><th>표시</th></tr>\n'
  + '    </thead>\n'
  + '    <tbody>\n'
  + '      <tr><td><strong style="color:#26E0C2">HIGH</strong></td><td>clean_30d_n ≥ 5, distinct_7d ≥ 5, ratio gate 통과</td><td>최신 가격</td></tr>\n'
  + '      <tr><td><strong>MEDIUM</strong></td><td>clean_30d_n ≥ 5, HIGH 조건 미충족, distinct_30d ≥ 10</td><td>30일 중앙값</td></tr>\n'
  + '      <tr><td><strong style="color:#E0B84A">LOW</strong></td><td>clean_30d_n ≥ 5, HIGH·MEDIUM 조건 미충족</td><td>30일 중앙값 + ⚠ 경고</td></tr>\n'
  + '      <tr><td><strong style="color:#FF4D6D">NONE</strong></td><td>clean_30d_n &lt; 5 (가장 먼저 판정)</td><td>"참고가 산출 불가"</td></tr>\n'
  + '    </tbody>\n'
  + '  </table>\n'
  + '  </div>';

function restoreOnce(source, after, before) {
  assert.equal(source.split(after).length - 1, 1, 'Only one exact approved replacement is accepted');
  return source.replace(after, before);
}

function assertPsaBaseline(source) {
  assert.ok(source.includes('  }\n' + psaCss + '</style>\n<!-- Google Analytics (gtag.js) -->'), 'Header CSS must stay at its own final style boundary');
  let restored = restoreOnce(source, psaCss, '');
  for (const [after, before] of psaPairs) restored = restoreOnce(restored, after, before);
  assert.equal(createHash('sha256').update(restored).digest('hex'), 'f64b94045a505cfff084da622036b9a71460d060a462812a228ccf3c8a16539c');
}

function assertAboutBaseline(source) {
  assert.ok(source.includes('  .page-nav a{flex:none}\n' + aboutCss + '  .panel{'), 'Header and table CSS must stay at the approved style boundary');
  let restored = restoreOnce(source, aboutCss, '');
  restored = restoreOnce(restored, newTable, oldTable);
  assert.equal(createHash('sha256').update(restored).digest('hex'), '494879ada9fe1e01d4c8226d589f3a4aeaea6b2c92c6343696fd1951c25d540a');
}

test('PSA content, resources, image and SEO remain byte-identical outside approved metadata, link name and header CSS', () => {
  assertPsaBaseline(psa);
  const schemas = [...psa.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  assert.equal(schemas.find(item => item['@type'] === 'Article').description, description);
  assert.doesNotMatch(psa, /BRG10|PSA BGS BRG/);
  assert.match(psa, /href="\/guide-brg-grading"/); // Legitimate related guide remains available.
  for (const [after] of psaPairs.slice(0, 3)) assert.ok(psa.includes(after));
});

test('PSA FAQ visible answers and structured answers remain in sync', () => {
  const faq = JSON.parse([...psa.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].find(match => match[1].includes('"@type": "FAQPage"'))[1]);
  const section = psa.split('<h2 id="faq">')[1].split('<hr ')[0];
  const answers = [...section.matchAll(/<h3>Q\. ([^<]*)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)];
  assert.equal(answers.length, faq.mainEntity.length);
  for (const [, question, answer] of answers) {
    const entry = faq.mainEntity.find(item => item.name === question);
    assert.ok(entry, question);
    assert.equal(answer.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), entry.acceptedAnswer.text);
  }
});

test('about body, resources, contact details and SEO remain unchanged outside the trust table and its local header CSS', () => {
  assertAboutBaseline(about);
});

test('four owned screens include scoped 44px header targets and visible keyboard focus', () => {
  assert.ok(psa.includes(psaCss));
  assert.ok(about.includes(aboutCss));
  assert.ok(releases.includes(cpCss));
  assert.ok(hub.includes(cpCss.split('\n').map(line => line ? '  ' + line : '').join('\n')));
  for (const source of [releases, hub]) {
    assert.match(source, /\.cp-nav\{[^}]*overflow-x:auto/);
    assert.match(source, /\.cp-topbar a:focus-visible[^}]*outline:2px solid #26E0C2/);
  }
});

test('approved content normalization rejects CSS movement, duplication, content injection and SEO drift', () => {
  const cases = [
    [assertPsaBaseline, psa, psa.replace(psaCss, psaCss.repeat(2)), 'duplicate PSA CSS'],
    [assertPsaBaseline, psa, psa.replace(psaCss, '').replace('<style>', '<style>\n' + psaCss), 'moved PSA CSS'],
    [assertPsaBaseline, psa, psa.replace('min-height:44px', 'min-height:24px'), 'changed PSA target'],
    [assertPsaBaseline, psa, psa.replace(description, description + ' unapproved'), 'changed PSA description'],
    [assertPsaBaseline, psa, psa.replace('</main>', '<p>Unapproved AI copy</p></main>'), 'PSA body injection'],
    [assertPsaBaseline, psa, psa.replace('href="https://cardpick.kr/guide-psa-grading-korea"', 'href="https://cardpick.kr/other"'), 'PSA canonical drift'],
    [assertAboutBaseline, about, about.replace(aboutCss, aboutCss.repeat(2)), 'duplicate about CSS'],
    [assertAboutBaseline, about, about.replace(aboutCss, '').replace('</style>', aboutCss + '</style>'), 'moved about CSS'],
    [assertAboutBaseline, about, about.replace('clean_30d_n &lt; 5', 'distinct_30d &lt; 5'), 'wrong NONE gate'],
    [assertAboutBaseline, about, about.replace(newTable, newTable.repeat(2)), 'duplicate trust table'],
    [assertAboutBaseline, about, about.replace('</main>', '<p>Unapproved copy</p></main>'), 'about body injection'],
    [assertAboutBaseline, about, about.replace('content="index,follow,max-image-preview:large"', 'content="noindex,follow"'), 'about robots drift'],
  ];
  for (const [check, original, changed, name] of cases) {
    assert.notEqual(changed, original, `${name}: fixture must change`);
    assert.throws(() => check(changed), { code: 'ERR_ASSERTION' }, name);
  }
});
