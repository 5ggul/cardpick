import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchQuery, escapeSearchToken, getTrustedSearchPrice, sortSearchCards } from '../search-query.mjs';

for (const [input, normalized] of [
  ['코코리', 'phanpy'], ['에브이', 'espeon'], ['이브이', 'eevee'], ['콘팡', 'venonat'],
  ['뮤', 'mew'], ['뮤츠 ex', 'mewtwo ex'], ['메가리자몽 X ex', 'mega charizard x ex'],
  ['뮤츠ex', 'mewtwo ex'], ['코코리205', 'phanpy 205'],
  ['왕콘치 21', 'seaking 21'], ['뮤 뮤츠', 'mew mewtwo'],
  ['Phanpy 205 sv8', 'phanpy 205 sv8'], ['모르는이름 sv8', '모르는이름 sv8'],
  ['커뮤니티', '커뮤니티'], ['리자몽카드', '리자몽카드'], [' *코코리* 205 ', 'phanpy 205'],
  ['\u110f\u1169\u110f\u1169\u1105\u1175', 'phanpy'],
]) {
  test(`query ${input}`, () => {
    const query = normalizeSearchQuery(input);
    assert.equal(query.normalized, normalized);
    assert.equal(query.original, input.normalize('NFC').trim().slice(0, 80));
    assert.deepEqual(query.tokens, normalized.split(/\s+/).filter(Boolean).slice(0, 5));
  });
}
test('bounded query and wildcard-only input cannot scan all cards', () => {
  assert.equal(normalizeSearchQuery('a'.repeat(100)).original.length, 80);
  assert.equal(normalizeSearchQuery('a b c d e f g').tokens.length, 5);
  assert.deepEqual(normalizeSearchQuery(' *** ').tokens, []);
  assert.deepEqual(normalizeSearchQuery(null).tokens, []);
});
test('literal SQL LIKE characters are escaped', () => {
  assert.equal(escapeSearchToken('a%_\\b'), 'a\\%\\_\\\\b');
  assert.equal(escapeSearchToken('*'), ' ');
});
for (const level of ['HIGH', 'MEDIUM', 'LOW']) {
  test(`price ${level} only uses display_krw`, () => {
    assert.equal(getTrustedSearchPrice({trust_level:level, display_krw:'1200.4', latest_krw:999999}), 1200);
  });
}
for (const value of [null, undefined, '', 'NaN', 'Infinity', -1, 0, 0.1, true, [], {}]) {
  test(`invalid price ${String(value)}`, () => assert.equal(getTrustedSearchPrice({trust_level:'HIGH',display_krw:value}), null));
}
for (const level of ['NONE', 'UNKNOWN', '', undefined]) {
  test(`unapproved trust ${level}`, () => assert.equal(getTrustedSearchPrice({trust_level:level,display_krw:999}), null));
}
test('missing trust fails closed', () => assert.equal(getTrustedSearchPrice(null), null));
test('relevance uses English alias and preserves caller array', () => {
  const rows = [
    {slug:'b', name:'Other Phanpy', popularity_rank:1},
    {slug:'a', name:'Phanpy', popularity_rank:5},
  ];
  assert.deepEqual(sortSearchCards(rows, normalizeSearchQuery('코코리').normalized).map(c=>c.slug), ['a', 'b']);
  assert.equal(rows[0].slug, 'b');
});
