import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../guide-cgc-grading.html', import.meta.url), 'utf8');
const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
test('all eight visible CGC FAQ answers match structured data', () => {
  const faq = schemas.find(s => s['@type'] === 'FAQPage').mainEntity;
  const questions = [...html.matchAll(/<div class="faq-q">Q\. ([\s\S]*?)<\/div>/g)].map(m => m[1]);
  const answers = [...html.matchAll(/<div class="faq-a">A\. ([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.equal(faq.length, 8);
  assert.deepEqual(faq.map(q => q.name), questions);
  assert.deepEqual(faq.map(q => q.acceptedAnswer.text), answers);
});
test('CGC no longer claims subgrades, market superiority or graded-price coverage', () => {
  assert.doesNotMatch(html, /서브그레이드와 캡슐 품질|거래가 가장 활발|PSA가 가장 활발|등급별 시세는/);
  assert.match(html, /CGC는 현재 서브그레이드를 제공하지 않으며/);
  assert.match(html, /CGC·PSA 등급별 거래가격으로 사용할 수 없습니다/);
  assert.match(html, /https:\/\/www.cgccards.com\/about\/help-center-faqs\/cgc-cards-grading\/about-cgc-grades\//);
});
test('correction date is consistent and original thumbnail/publication remain', () => {
  const article = schemas.find(s => s['@type'] === 'Article');
  assert.equal(article.dateModified, '2026-10-01');
  assert.match(html, /최종 수정 2026-10-01/);
  assert.equal(article.datePublished, '2026-06-16T15:00:00+09:00');
  assert.deepEqual(article.image, ['https://cardpick.kr/images/guides/cgc-grading-hero.webp']);
  assert.match(html, /<link rel="canonical" href="https:\/\/cardpick.kr\/guide-cgc-grading">/);
});
