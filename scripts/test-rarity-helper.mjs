// Routing/DOM contract tests, not self-certification of rarity facts.
// Existing table facts are retained; official sources are named in the guide/module.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const script = readFileSync(new URL('js/cp-rarity-helper.js',root),'utf8');
const html = readFileSync(new URL('guide-card-rarities.html',root),'utf8');
const scope = {};
vm.runInNewContext(script,scope,{timeout:1000});
const resolve = scope.CPRarityHelper.resolve;
const entries = {krjp:[{key:'SAR',label:'SAR (스페셜 아트레어)',detail:'일본판·한글판 표의 설명'}],en:[{key:'금색 별 1개',label:'Illustration Rare',detail:'영문판 표의 설명'}],
  jaMega:[{key:'MUR',label:'MUR (공식 카드검색의 레어리티 코드)',detail:'일본판 공식 카드검색에서 확인'},
    {key:'MA',label:'MA (메가어택레어)',detail:'일본 공식 MA 소개와 MEGA 드림 ex에서 확인'}]};
const selection = {purpose:'rarity',language:'ja',series:'sv',mark:'SAR'};

test('helper reads labels from existing tables, not a guessed cross-language card mapping',()=>{
  assert.match(script,/querySelectorAll\('tbody tr'\)/);
  assert.match(script,/한글판과 일본판 레어도 약어 표/);
  assert.match(script,/영문판 스칼렛 바이올렛 레어도 기호 표/);
  assert.doesNotMatch(script,/fetch\(|innerHTML|eval\(|localStorage|gtag\(/);
});
test('known Japanese symbol links to that language table without converting SAR to SIR',()=>{
  const result=resolve(selection,entries);
  assert.match(result.text,/SAR/);assert.match(result.text,/자동 치환/);
  assert.equal(result.href,'#kr-jp');assert.equal(result.sourceHref,'https://www.pokemon-card.com/card-search/');
});
test('Korean symbol uses Korean official search',()=>{
  assert.equal(resolve({...selection,language:'ko'},entries).sourceHref,'https://pokemoncard.co.kr/cards');
});
test('English illustration symbol uses English table and source',()=>{
  const result=resolve({...selection,language:'en',mark:'금색 별 1개'},entries);
  assert.match(result.text,/Illustration Rare/);assert.equal(result.href,'#english');
  assert.equal(result.sourceHref,'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards');
});
for(const language of ['unknown','__proto__','constructor','<script>'])test('invalid language '+language+' cannot select another-language mapping',()=>{
  const result=resolve({...selection,language},entries);assert.equal(result.href,'#identify');assert.doesNotMatch(result.text,/스페셜 아트레어/);
});
for(const series of ['unknown','swsh','<script>'])test('outside-series '+series+' does not apply Scarlet/Violet classifications',()=>{
  const result=resolve({...selection,series},entries);assert.equal(result.href,'#identify');assert.match(result.text,/他|다른 시리즈|특수 제품/);
});
test('SAR is not accepted as an English symbol and unlisted symbols are not guessed',()=>{
  assert.equal(resolve({...selection,language:'en'},entries).href,'#identify');
  for(const mark of ['MUR','EX','PSA10','__proto__','<img onerror=alert(1)>'])assert.equal(resolve({...selection,mark},entries).href,'#identify');
});
for(const mark of ['MUR','MA'])test('Japanese MEGA '+mark+' uses only the dedicated Japanese scope',()=>{
  const result=resolve({...selection,series:'mega',mark},entries);
  assert.equal(result.href,'#mega-jp');assert.equal(result.sourceHref,'https://www.pokemon-card.com/card-search/');
  assert.match(result.text,new RegExp(mark));assert.match(result.text,/自|자동 치환/);
  for(const language of ['ko','en','unknown']){
    const other=resolve({...selection,language,series:'mega',mark},entries);
    assert.equal(other.href,'#identify');assert.notEqual(other.href,'#mega-jp');
  }
  assert.equal(resolve({...selection,mark},entries).href,'#identify','MEGA codes never enter the SV table');
});
test('Japanese MEGA rejects other symbols even if a caller inserts them in the data',()=>{
  for(const mark of ['SAR','EX','PSA10','__proto__','<img onerror=alert(1)>']){
    const data={...entries,jaMega:[{key:mark,label:'unapproved',detail:'unapproved'}]};
    assert.equal(resolve({...selection,series:'mega',mark},data).href,'#identify');
  }
  assert.equal(resolve({...selection,series:'mega',mark:'MA'},{}).href,'#identify');
});
test('MEGA data comes only from its readable table and series changes rebuild the options',()=>{
  assert.match(script,/jaMega: rows\('\[aria-label="일본판 MEGA MUR MA 확인 표"\] table', false\)/);
  assert.match(script,/byId\('series'\)\.addEventListener\('change', \(\) => \{options\(\);render\(\);\}\)/);
  assert.match(html,/<option value="mega">MEGA \(일본판 MUR·MA 확인\)<\/option>/);
  const mega=html.match(/<div class="table-wrap"[^>]*aria-label="일본판 MEGA MUR MA 확인 표"[^>]*>([\s\S]*?)<\/table>/)[1];
  assert.deepEqual([...mega.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map(match=>match[1]),['MUR','MA']);
  const sv=html.match(/aria-label="한글판과 일본판 레어도 약어 표"([\s\S]*?)<\/table>/)[1];
  assert.doesNotMatch(sv,/MUR|\bMA\b/);
  assert.match(html,/이 글은 풀네임을 확정하지 않습니다/);
  assert.doesNotMatch(mega,/Mega Ultra|메가울트라|Mega Attack|최상위|봉입률 \d|\d+원/);
});
test('condition grade routes away from rarity without a grade/price prediction',()=>{
  const result=resolve({...selection,purpose:'condition'},entries);
  assert.equal(result.href,'/guide-psa-grades');assert.equal(result.sourceHref,'/tools/centering-checker');
  assert.match(result.text,/높낮이를 비교할 수 없습니다/);assert.match(result.text,/확정할 수도 없습니다/);
});
test('missing data/unknown purpose remain a safe guide link',()=>{
  for(const [state,data] of [[undefined,entries],[{...selection,purpose:'bad'},entries],[selection,undefined],[selection,{}]])assert.equal(resolve(state,data).href,'#identify');
});
test('progressive enhancement leaves original readable tables and links without JavaScript',()=>{
  assert.match(html,/<fieldset id="cp-rarity-controls" hidden>/);
  assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/<script src="\/js\/cp-rarity-helper\.js\?v=20261016" defer><\/script>/);
  for(const id of ['kr-jp','english','mega-jp','identify','faq'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/\.cp-rarity-helper fieldset\{border:0/);
  assert.match(html,/padding:20px 16px/);assert.match(html,/min-height:44px/);assert.match(html,/:focus-visible/);
  assert.match(html,/\.cp-rarity-helper\{[^}]*scroll-margin-top:80px/);
  assert.match(html,/#kr-jp,#english,#mega-jp,#identify\{scroll-margin-top:80px\}/);
});
