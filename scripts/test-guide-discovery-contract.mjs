// Local regression contracts, not proof of search demand, indexing or factual accuracy.
// The language/finish distinction was independently checked against TCGplayer's
// Pokémon rarity and Japanese Pokémon FAQs on 2026-10-14. No network is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/guides.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const home = read('index.html');
const price = read('guide-card-price.html');
const hub = await (await onRequest()).text();
const plain = html => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const entries = source => [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap(match => {
    const value = JSON.parse(match[1]);
    return Array.isArray(value) ? value : value['@graph'] || [value];
  });
function faq(source) {
  const matches = entries(source).filter(entry => entry['@type'] === 'FAQPage');
  assert.equal(matches.length, 1, 'Exactly one FAQ schema is expected');
  assert.equal(new Set(matches[0].mainEntity.map(entry => entry.name)).size, matches[0].mainEntity.length,
    'Duplicate FAQ questions are not permitted');
  return matches[0].mainEntity;
}

const homeQuestions = [
  '포켓몬 카드 시세는 어디서 확인하나요?',
  'PSA 그레이딩은 어디서 신청하나요?',
  '포켓몬 카드 발매일·신규 박스 정보는 어디서 보나요?',
];
function assertHomeCopy(source) {
  const section = source.match(/<section class="panel" id="faq"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'Home FAQ must remain visible in initial HTML');
  const visible = [...section.matchAll(/<details\b[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/g)]
    .map(([, question, answer]) => ({ name: plain(question).replace(/^Q\d+\s*/, ''), text: plain(answer), answer }));
  assert.equal(visible.length, 8, 'Existing FAQ question count is unchanged');
  const structured = faq(source);
  for (const name of homeQuestions) {
    const rows = visible.filter(entry => entry.name === name);
    const schemas = structured.filter(entry => entry.name === name);
    assert.equal(rows.length, 1, name);
    assert.equal(schemas.length, 1, name);
    assert.equal(rows[0].text, schemas[0].acceptedAnswer.text, 'Visible and structured answer must agree: ' + name);
  }
  const priceAnswer = visible.find(entry => entry.name === homeQuestions[0]);
  assert.equal((source.match(/href="\/guide-card-price"/g) || []).length, 1,
    'The approved contextual price-guide link appears only once');
  assert.match(priceAnswer.answer, /href="\/guide-card-price">포켓몬 카드 시세 확인법<\/a>/);
  assert.match(priceAnswer.text, /신뢰도 기준을 통과한 카드/);
  const psaAnswer = visible.find(entry => entry.name === homeQuestions[1]);
  assert.match(psaAnswer.answer, /href="\/tools\/psa-grading-break-even">PSA 손익분기 계산기<\/a>/);
  assert.doesNotMatch(psaAnswer.answer, /href="\/tools#psa"/);
  const release = visible.find(entry => entry.name === homeQuestions[2]).text;
  assert.match(release, /한국판·일본판·영문판/);
  assert.match(release, /전체 발매 목록은 아니며/);
  assert.match(release, /별도의 제3자 데이터/);
  assert.doesNotMatch(section, /BRG10 비교|공식 출처 통합 후 게시 예정/);
  const card = slug => source.match(new RegExp('<a href="/' + slug + '">([\\s\\S]*?)<\\/a>'))?.[1];
  const fake = card('guide-fake-detection');
  const psa = card('guide-psa-grading-korea');
  assert.ok(fake && psa, 'Existing guide cards must remain');
  assert.match(plain(fake), /같은 언어판·세트·번호·가공/);
  assert.match(plain(fake), /단일 신호로 판별할 수 없는 이유/);
  assert.doesNotMatch(fake, /5가지 식별 신호/);
  assert.match(plain(psa), /비용 항목, 신청 절차, 포장·배송 전 확인 사항/);
  assert.doesNotMatch(psa, /BRG10 비교/);
}

function assertPriceGuide(source) {
  const identity = source.match(/<div class="identity-result">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(identity);
  assert.match(plain(identity), /언어판·홀로·리버스 홀로 등 가공/);
  assert.doesNotMatch(plain(identity), /네 가지가 모두 일치해야 같은 카드/);
  const formula = source.match(/<div class="identity-formula">([\s\S]*?)<\/div>/)?.[1];
  assert.deepEqual([...formula.matchAll(/<b>([^<]*)<\/b>/g)].map(([, label]) => label),
    ['카드 이름', '세트', '카드 번호', '레어도'], 'Existing four-part visual formula is retained');
  const visible = [...source.matchAll(/<div class="faq-q">Q\. ([\s\S]*?)<\/div>\s*<div class="faq-a">A\. ([\s\S]*?)<\/div>/g)]
    .map(([, name, text]) => ({ name: plain(name), text: plain(text) }));
  const structured = faq(source);
  assert.equal(visible.length, 10);
  assert.equal(structured.length, visible.length);
  for (const row of visible) {
    const item = structured.find(entry => entry.name === row.name);
    assert.ok(item, row.name);
    assert.equal(item.acceptedAnswer.text, row.text, row.name);
  }
  const answer = visible.find(entry => entry.name === homeQuestions[0]).text;
  assert.match(answer, /신뢰도 기준을 통과한 카드의/);
  assert.match(answer, /참고가가 표시되지 않는 카드는 가격을 임의로 추정하지 마세요/);
  assert.match(answer, /국내 거래가는 별도로 확인/);
  const article = entries(source).find(entry => entry['@type'] === 'Article');
  assert.equal(article.datePublished, '2026-06-11', 'Original publication date is retained');
  assert.equal(article.dateModified, '2026-10-14', 'The substantive approved edit has an actual modification date');
  const modified = source.match(/<meta property="article:modified_time" content="([^"]+)">/)?.[1];
  const published = source.match(/<meta property="article:published_time" content="([^"]+)">/)?.[1];
  assert.equal(modified, article.dateModified, 'Open Graph and Article modification dates agree without a fabricated time');
  assert.equal(published, '2026-06-11T15:00:00+09:00', 'Original publication timestamp is preserved');
  assert.match(source, /CARD GUIDE · 발행 2026-06-11 · 최종 수정 2026-10-14<\/div>/);
  assert.match(source, /rel="canonical" href="https:\/\/cardpick\.kr\/guide-card-price"/);
}

function assertHubCopy(source, guide) {
  const card = source.match(/<a href="\/guide-card-price" class="guide-card group"[^>]*>([\s\S]*?)<\/a>/)?.[1];
  assert.ok(card, 'Existing price-guide card must remain');
  const title = plain(card.match(/<h3 class="title">([\s\S]*?)<\/h3>/)?.[1] || '');
  const excerpt = plain(card.match(/<p class="excerpt">([\s\S]*?)<\/p>/)?.[1] || '');
  const article = entries(guide).find(entry => entry['@type'] === 'Article');
  assert.equal(title, article.headline, 'Hub title reflects the actual guide');
  assert.match(excerpt, /코코리·큐레무 ex 사례/);
  assert.match(excerpt, /언어판·가공과 Raw·PSA/);
  assert.match(excerpt, /TCGplayer 참고가·eBay 판매 완료 가격·국내 거래가/);
  const collection = entries(source).find(entry => entry['@type'] === 'CollectionPage');
  const item = collection.mainEntity.itemListElement.find(entry => entry.url === 'https://cardpick.kr/guide-card-price').item;
  assert.equal(item.headline, title);
  assert.equal(item.description, excerpt);
  assert.equal(item.datePublished, '2026-06-11');
  assert.equal(collection.mainEntity.numberOfItems, 39, 'No guide pages or cards are added');
}

test('home corrects the three stale guide promises and synchronizes exactly the edited FAQs', () => assertHomeCopy(home));
test('price guide preserves its visual formula while making language, finish and reference-price scope explicit', () => assertPriceGuide(price));
test('guide hub card and its Article metadata describe the existing worked-example price guide', () => assertHubCopy(hub, price));

test('home contracts reject stale promises, duplicate contextual links and schema drift', () => {
  const cases = [
    home.replace('단일 신호로 판별할 수 없는 이유', '5가지 식별 신호'),
    home.replace('비용 항목, 신청 절차, 포장·배송 전 확인 사항', 'BRG10 비교'),
    home.replace('전체 발매 목록은 아니며', '공식 출처 통합 후 게시 예정이며'),
    home.replace('"name":"포켓몬 카드 발매일·신규 박스 정보는 어디서 보나요?"', '"name":"다른 질문"'),
    home.replace('href="/guide-card-price"', 'href="/guides"'),
    home.replace('</main>', '<a href="/guide-card-price">duplicate</a></main>'),
  ];
  // This changes only the schema occurrence of a substring also present in visible text.
  cases.push(home.replace('손익분기는 PSA 손익분기 계산기로 확인할 수 있습니다."', '손익분기는 제공하지 않습니다."'));
  cases.push(home.replace('href="/tools/psa-grading-break-even"', 'href="/tools#psa"'));
  for (const changed of cases) {
    assert.notEqual(changed, home, 'Mutation must alter its source');
    assert.throws(() => assertHomeCopy(changed), { code: 'ERR_ASSERTION' });
  }
});

test('price-guide contracts reject lost finish/trust conditions, FAQ drift and artificial freshness', () => {
  const cases = [
    price.replace('언어판·홀로·리버스 홀로 등 가공', '카드 이름'),
    price.replaceAll('신뢰도 기준을 통과한 카드의 ', ''),
    price.replaceAll('참고가가 표시되지 않는 카드는 가격을 임의로 추정하지 마세요.', ''),
    price.replace('"dateModified":"2026-10-14"', '"dateModified":"2026-09-21"'),
    price.replace('최종 수정 2026-10-14', '최종 수정 2026-10-15'),
    price.replace('"datePublished":"2026-06-11"', '"datePublished":"2026-10-14"'),
    price.replace('property="article:modified_time" content="2026-10-14"', 'property="article:modified_time" content="2026-09-21"'),
    price.replace('property="article:published_time" content="2026-06-11T15:00:00+09:00"', 'property="article:published_time" content="2026-10-14T15:00:00+09:00"'),
    price.replace('"text":"카드픽에서 카드명·세트·번호로 검색하면', '"text":"다른 설명: 카드픽에서 카드명·세트·번호로 검색하면'),
  ];
  for (const changed of cases) {
    assert.notEqual(changed, price, 'Mutation must alter its source');
    assert.throws(() => assertPriceGuide(changed), { code: 'ERR_ASSERTION' });
  }
});

test('hub contracts reject stale or independently altered title, excerpt and structured metadata', () => {
  const cases = [
    hub.replace(articleTitle(price), '포켓몬 카드 가격 보는 법: 시세 확인법과 정해지는 원리'),
    hub.replace('코코리·큐레무 ex 사례', '시세를 보장하는 사례'),
    hub.replace('언어판·가공과 Raw·PSA', 'Raw·PSA'),
    hub.replace('"numberOfItems":39', '"numberOfItems":40'),
  ];
  for (const changed of cases) {
    assert.notEqual(changed, hub, 'Mutation must alter its source');
    assert.throws(() => assertHubCopy(changed, price), { code: 'ERR_ASSERTION' });
  }
});
function articleTitle(source) { return entries(source).find(entry => entry['@type'] === 'Article').headline; }
