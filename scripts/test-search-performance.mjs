import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/search.js';
import config from './search-tailwind.config.cjs';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8').replace(/\r\n/g, '\n');
const source = read('functions/search.js');
const css = read('styles/search-base.css');
const hash = value => createHash('sha256').update(value).digest('hex');

test('performance changes preserve the approved search logic, body, reporting and response contract', () => {
  assert.equal(hash(source.split('  const html = ')[0]), 'bacbfd037458a0bedca74dd1f11a781b1cad4bed9f6fe5ed2379b9c5b1878ba4');
  assert.equal(hash(source.split('</head><body>')[1]), 'cf57dfcbbf44f65165048bee3a32d25576b9ef8dbfeaaf585c35d7b4d52d6196');
  assert.equal(hash(read('search.js')), '50884601131ec364a1986572b728b57c2a88653e820c8f96dd1f47ade173e67a');
});

test('compiled CSS scans every SSR state and preserves the original Tailwind 3.4.17 theme', () => {
  assert.deepEqual(config.content, ['./functions/search.js']);
  assert.deepEqual(config.theme.extend.colors, {bg:'#05080D',panel:'#0D121B',panel2:'#111722',line:'rgba(255,255,255,0.08)',ink:'#E8EDF5',muted:'#8B96A8',up:'#26E0C2',down:'#FF4D6D',brand:'#26E0C2'});
  assert.deepEqual(config.theme.extend.fontFamily, {sans:['Pretendard','system-ui','sans-serif'],mono:['"IBM Plex Mono"','ui-monospace','monospace']});
  assert.match(css, /tailwindcss v3\.4\.17/);
  assert.ok(Buffer.byteLength(css) < 20_000, 'search utility CSS should remain bounded');
  const selectors=['.w-24{','.w-20{','.w-16{','.min-w-0{','.hidden{','.block{','.leading-relaxed{','.text-up{','.text-down{','.divide-line','.hover\\:bg-panel2:hover{','.sm\\:block{','.md\\:block{','.lg\\:px-8{','.max-w-\\[1280px\\]{','.max-w-\\[600px\\]{','.text-\\[13px\\]{','.tracking-\\[0\\.16em\\]{','.text-ink\\/80{'];
  for(const selector of selectors)assert.ok(css.includes(selector), selector);
  const declarations=['.bg-bg{--tw-bg-opacity:1;background-color:rgb(5 8 13/var(--tw-bg-opacity,1))}', '.bg-brand{--tw-bg-opacity:1;background-color:rgb(38 224 194/var(--tw-bg-opacity,1))}', '.bg-panel{--tw-bg-opacity:1;background-color:rgb(13 18 27/var(--tw-bg-opacity,1))}', '.text-up{--tw-text-opacity:1;color:rgb(38 224 194/var(--tw-text-opacity,1))}', '.text-down{--tw-text-opacity:1;color:rgb(255 77 109/var(--tw-text-opacity,1))}', '.text-ink{--tw-text-opacity:1;color:rgb(232 237 245/var(--tw-text-opacity,1))}', '.text-muted{--tw-text-opacity:1;color:rgb(139 150 168/var(--tw-text-opacity,1))}', '.w-24{width:6rem}', '.gap-2{gap:.5rem}', '.p-5{padding:1.25rem}', '.font-mono{font-family:IBM Plex Mono,ui-monospace,monospace}', '@media (min-width:640px){.sm\\:block{display:block}}', '@media (min-width:768px){.md\\:block{display:block}}'];
  for(const declaration of declarations)assert.ok(css.includes(declaration),declaration);
  assert.doesNotMatch(css, /@import|@font-face|cdn\.tailwindcss|fonts\.googleapis/);
  assert.equal(read('styles/search.input.css').match(/@tailwind /g).length,3);
});

test('the exact compiled search stylesheet is critical and fonts do not require a browser compiler', () => {
  assert.equal(source.match(/href="\/styles\/search-base\.css\?v=20261012"/g).length,1);
  assert.match(source, /<link rel="stylesheet" href="\/styles\/search-base\.css\?v=20261012">/);
  assert.doesNotMatch(source, /cdn\.tailwindcss\.com|tailwind\.config|fonts\.googleapis\.com|fonts\.gstatic\.com|web\/static\/pretendard/);
  for(const file of ['releases-fonts.css','set-fonts.css']){
    assert.ok(source.includes(`<link rel="stylesheet" href="/styles/${file}" media="print" onload="this.media='all'">`));
    assert.ok(source.match(/<noscript>([\s\S]*?)<\/noscript>/)[1].includes(`<link rel="stylesheet" href="/styles/${file}">`));
  }
});

test('existing complete optional font resources and unmodified local Mono faces remain available', () => {
  const pretendard = read('styles/releases-fonts.css');
  assert.ok((pretendard.match(/@font-face/g)||[]).length>50, 'dynamic subsets must retain fallback for arbitrary searches');
  assert.match(pretendard, /font-family: 'Pretendard'/);
  assert.doesNotMatch(pretendard, /font-display:\s*(?:swap|block)/);
  const mono=read('styles/set-fonts.css');
  assert.equal((mono.match(/@font-face/g)||[]).length,15);
  for(const weight of [400,500,600])assert.equal((mono.match(new RegExp('font-weight:'+weight+';','g'))||[]).length,5);
  assert.equal((mono.match(/font-display:optional/g)||[]).length,15);
  for(const [,file] of mono.matchAll(/url\((\/fonts\/[^)]+)\)/g)){
    assert.ok(existsSync(new URL(file.slice(1),root)),file);assert.ok(statSync(new URL(file.slice(1),root)).size>0);
  }
  assert.ok(existsSync(new URL('fonts/ibm-plex-mono/OFL.txt',root)));
});

test('search-only mobile touch rules retain desktop styling and visible keyboard focus', () => {
  assert.match(source, /@media\(max-width:768px\)\{\.chip\{min-height:44px;min-width:44px/);
  assert.match(source, /header \.search-header-form input\{min-height:44px\}/);
  assert.match(source, /header \.search-header-inner>a,header \.search-header-nav a\{[^}]*min-height:44px;min-width:44px/);
  assert.match(source, /main a\.inline-block,main a\[href\^="\/cards\/"\]\{min-height:44px/);
  assert.match(source, /a:focus-visible,input\[type="search"\]:focus-visible\{outline:2px solid #26E0C2;outline-offset:3px\}/);
  assert.doesNotMatch(source, /transition:all|outline:none|maximum-scale|user-scalable/);
});

for(const state of ['empty','zero','card','filtered-zero','query-error','partial']){
  test(`${state}: initial SSR includes usable critical CSS and no-JS font fallback without extra reads`, async () => {
    const saved=globalThis.fetch;const calls=[];
    globalThis.fetch=async(input,options={})=>{
      assert.equal(options.method||'GET','GET');const table=new URL(input).pathname.split('/').at(-1);calls.push(table);
      if(state==='query-error')throw Error('test-only provider failure');
      if(table==='cards')return Response.json(state==='zero'?[]:[{slug:'test-only-card',name:'Test-only card',game:'pokemon',number:'1',set_name:'Test-only set'}]);
      if(table==='card_price_trust'&&state==='partial')return new Response('',{status:503});
      return Response.json([]);
    };
    try{
      const url=new URL('http://127.0.0.1/search');if(state!=='empty')url.searchParams.set('q','test-only');if(state==='filtered-zero')url.searchParams.set('has_price','1');
      const response=await onRequest({request:new Request(url)});const html=await response.text();assert.equal(response.status,200);
      assert.equal(html.match(/href="\/styles\/search-base\.css\?v=20261012"/g).length,1);assert.match(html,/<noscript><link rel="stylesheet" href="\/styles\/releases-fonts.css"><link rel="stylesheet" href="\/styles\/set-fonts.css"><\/noscript>/);
      assert.doesNotMatch(html,/cdn\.tailwindcss|fonts\.googleapis|\/api\/(?:search-log|request-update)/);
      assert.deepEqual(calls,state==='empty'?[]:['zero','query-error'].includes(state)?['cards']:['cards','card_price_summary_best','card_movement_cardmarket','card_price_trust']);
      const links=[...html.matchAll(/href="\/cards\/([^"]+)"/g)].map(match=>match[1]);
      assert.deepEqual(links,['card','partial'].includes(state)?['test-only-card']:[]);
      const expectedText={empty:'상단 검색창에 카드명·세트 코드·번호를 입력하세요.',zero:'검색어와 일치하는 카드를 찾지 못했습니다.',card:'1건 (1장 표시)','filtered-zero':'선택한 조건에 맞는 카드가 없습니다.','query-error':'검색에 실패했습니다. 잠시 후 다시 시도해 주세요.',partial:'일부 참고가·변동 정보를 불러오지 못했습니다.'};
      assert.ok(html.includes(expectedText[state]),state+' must retain its own SSR content');
      assert.equal(html.includes('role="alert"'),state==='query-error');
      assert.equal(html.includes('role="status"'),state==='partial');
      assert.match(html,/<meta name="robots" content="noindex,follow">/);assert.match(html,/<link rel="canonical" href="https:\/\/cardpick.kr\/search">/);
    }finally{globalThis.fetch=saved;}
  });
}
