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
const searchAccessibilityPairs = [
  ["    input.setAttribute('aria-controls', 'cp-search-results');\n    box.setAttribute('role', 'region');\n    box.setAttribute('aria-label', '카드 검색 결과');\n    box.setAttribute('aria-live', 'polite');",
   "    input.setAttribute('aria-controls', 'cp-search-results');\n    input.setAttribute('aria-expanded', 'false');\n    box.setAttribute('aria-live', 'polite');"],
  ["      box.style.display = 'none'; box.innerHTML = '';\n    }",
   "      box.style.display = 'none'; box.innerHTML = '';\n      input.setAttribute('aria-expanded', 'false');\n    }"],
  ["    function show() { box.style.display = 'block'; }",
   "    function show() { box.style.display = 'block'; input.setAttribute('aria-expanded', 'true'); }"],
];
function assertOriginalSharedSearch(value) {
  let normalized = value;
  for (const [after, before] of searchAccessibilityPairs) {
    assert.equal(value.split(after).length - 1, 1, 'one exact search semantics change');
    assert.equal(value.split(before).length - 1, 0, 'no stale search semantics');
    normalized = normalized.replace(after, before);
  }
  assert.equal(hash(normalized), '1a6f0656ad867d6ed7aff7953bc9de9764dd219deb3ae56bc70ac044502982ed');
}

const originalHomeFonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;
const homeFontDigest = '5fcf88b31ae16833f1e99ec3ce84f50d7ca1c8cff44bfc470bd981c49f0d865d';
const homeReplacements = [
  ['    --sans:"Cardpick Text","Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;',
   '    --sans:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;'],
  ['  .legal{border-top:1px solid var(--line);padding:14px 0;display:flex;flex-wrap:wrap;gap:14px;font-family:var(--mono);font-size:11px;color:var(--sub);align-items:center}',
   '  .legal{border-top:1px solid var(--line);padding:14px 0;display:flex;flex-wrap:wrap;gap:14px;font-family:var(--mono);font-size:11px;color:var(--dim);align-items:center}'],
  ['    <div class="panel-foot" style="border-top:1px solid var(--line);font-size:11.5px;color:var(--sub);line-height:1.5;padding:12px 16px">',
   '    <div class="panel-foot" style="border-top:1px solid var(--line);font-size:11.5px;color:var(--dim);line-height:1.5;padding:12px 16px">'],
  ['  <script defer src="/auth.js?v=v3clean"></script>\n  <script defer src="/search.js?v=20260519ko"></script>',
   '  <script src="/auth.js?v=v3clean"></script>\n  <script src="/search.js?v=20260519ko"></script>'],
];
function normalizeHomePerformance(home) {
  const blocks = [...home.matchAll(/<style id="home-font-css">[\s\S]*?<\/style>/g)];
  assert.equal(blocks.length, 1, 'one exact page-owned font block');
  const fontBlock = blocks[0][0];
  assert.equal(hash(fontBlock), homeFontDigest, 'font ranges, URLs, strategies and narrow shared-UI aliases are immutable');
  const resource = fontBlock;
  assert.equal(home.split(resource).length - 1, 1);
  assert.ok(home.includes('<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n' + resource + '\n\n<style>'),
    'font resources remain at their exact original head anchor');
  assert.ok(home.indexOf(resource) < home.indexOf('</head>'));
  assert.equal(home.split('/fonts/cardpick-text/home.woff2').length - 1, 1, 'one local font source, without a regressing preload');
  assert.doesNotMatch(home, /<link[^>]*rel="preload"[^>]*href="\/fonts\/cardpick-text\/home\.woff2"/);
  let normalized = home.replace(resource, originalHomeFonts);
  for (const [after, before] of homeReplacements) {
    assert.equal(home.split(after).length - 1, 1, 'only one exact reviewed replacement');
    assert.equal(home.split(before).length - 1, 0, 'no stale or duplicate approved replacement');
    normalized = normalized.replace(after, before);
  }
  return normalized;
}

test('performance changes preserve the approved search logic, body, reporting and response contract', () => {
  assert.equal(hash(source.split('  const html = ')[0]), 'bacbfd037458a0bedca74dd1f11a781b1cad4bed9f6fe5ed2379b9c5b1878ba4');
  assert.equal(hash(source.split('</head><body>')[1]), 'cf57dfcbbf44f65165048bee3a32d25576b9ef8dbfeaaf585c35d7b4d52d6196');
  // Only the separately approved shared UI stability patch changes this asset.
  assertOriginalSharedSearch(read('search.js'));
});

test('shared search semantics normalization rejects role, state, query, price and arbitrary-code drift', () => {
  const shared = read('search.js');
  const cases = [
    shared.replace(searchAccessibilityPairs[0][0], searchAccessibilityPairs[0][1]),
    shared.replace("box.setAttribute('role', 'region')", "box.setAttribute('role', 'listbox')"),
    shared.replace("input.setAttribute('aria-label', '카드명 검색');", "input.setAttribute('role', 'combobox');\n    input.setAttribute('aria-label', '카드명 검색');"),
    shared.replace(searchAccessibilityPairs[2][0], searchAccessibilityPairs[2][1]),
    shared.replace("'카드 검색 결과'", "'다른 결과'"),
    shared.replace("box.setAttribute('aria-live', 'polite');", "box.setAttribute('aria-live', 'off');"),
    shared.replace("box.setAttribute('role', 'region');", "box.setAttribute('role', 'region');\n    box.setAttribute('role', 'region');"),
    shared.replace('encodeURIComponent(lastQuery)', "encodeURIComponent('unapproved')"),
    shared.replace('c.price_krw == null', 'false'),
    shared + '\nwindow.unapproved = true;\n',
  ];
  for (const changed of cases) {
    assert.notEqual(changed, shared, 'negative fixture must mutate source');
    assert.throws(() => assertOriginalSharedSearch(changed), { code:'ERR_ASSERTION' });
  }
});

const homeLayoutDigest = '4aa63bed8a35a52fd92cce126af911e8c5b506a63f1d184e4bf8dfa76528d027';
const homeRendererDigest = '0593e4f7a7d114b4d3373139ad9de29be636073e8d82087762458495861448e5';
const oldHomeToggle = "  // ---------- 전체 50건 토글 ----------\n  var expandLink = document.getElementById('cp-expand-prices');\n  if (expandLink) {\n    expandLink.addEventListener('click', function(e){\n      e.preventDefault();\n      var collapsed = expandLink.getAttribute('data-state') === 'collapsed';\n      window.cardpickExpanded = collapsed;\n      expandLink.setAttribute('data-state', collapsed ? 'expanded' : 'collapsed');\n      expandLink.textContent = collapsed ? '간단히 보기 ▴' : '전체 참고가 50건 보기 ▾';\n      var activeTab = document.querySelector('#prices .tab[aria-selected=\"true\"]');\n      renderPrices(activeTab ? activeTab.dataset.tab : 'all');\n    });\n  }\n\n";
const homeLayoutPairs = [
  ['  const body = document.getElementById(\'priceBody\');\n  const homePriceLayout = window.cardpickHomePrices;', '  const body = document.getElementById(\'priceBody\');'],
  ['  function renderPrices(tab){\n    const previousFocus = homePriceLayout ? homePriceLayout.captureFocus() : null;\n    if (homePriceLayout) homePriceLayout.count = cards.length;', '  function renderPrices(tab){'],
  ['      if (body.querySelector(\'tr[data-ssr="1"]\')) {\n        if (homePriceLayout) homePriceLayout.sync();\n        return;\n      }', '      if (body.querySelector(\'tr[data-ssr="1"]\')) return;'],
  ['      if (homePriceLayout) { homePriceLayout.sync(); homePriceLayout.restoreFocus(previousFocus); }\n      return;', '      return;'],
  ["    }).join('');\n    if (homePriceLayout) { homePriceLayout.sync(); homePriceLayout.restoreFocus(previousFocus); }\n  }\n  renderPrices('all');", "    }).join('');\n  }\n  renderPrices('all');"],
  ["    } catch (e) { console.warn('home cards', e); }\n    finally { if (homePriceLayout) homePriceLayout.sync(); }", "    } catch (e) { console.warn('home cards', e); }"],
  ['      <button type="button" id="cp-expand-prices" data-state="collapsed" aria-controls="priceBody" disabled>현재 참고가 보기 ▾</button>', '      <a href="#" id="cp-expand-prices" data-state="collapsed">전체 참고가 50건 보기 ▾</a>'],
  ['class="brand" aria-label="카드픽 CARDPICK 홈"', 'class="brand" aria-label="카드픽 홈"'],
  ['  .foot h2{font-size:11px;font-family:var(--mono);color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-weight:500}', '  .foot h4{font-size:11px;font-family:var(--mono);color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px;font-weight:500}'],
  ...['데이터','가이드','운영'].map(label => ['        <h2>'+label+'</h2>', '        <h4>'+label+'</h4>']),
];
function normalizeHomeLayout(home) {
  const blocks = [...home.matchAll(/<!-- CARDPICK_HOME_PRICE_LAYOUT_START -->[\s\S]*?<!-- CARDPICK_HOME_PRICE_LAYOUT_END -->/g)];
  assert.equal(blocks.length,1,'one isolated home layout bootstrap');
  const block=blocks[0][0];
  assert.equal(hash(block),homeLayoutDigest,'exact reviewed folding, fallback control and focus contract');
  assert.ok(home.startsWith('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'+block+'\n<template data-cp-ad-loader>'),'critical bootstrap stays immediately after charset');
  const renderers=[...home.matchAll(/  \/\/ ---------- 전체 50건 토글 ----------[\s\S]*?(?=  \/\/ ---------- Tab wiring)/g)];
  assert.equal(renderers.length,1);
  assert.equal(hash(renderers[0][0]),homeRendererDigest,'one exact renderer attachment, no second expand owner');
  let normalized=home.replace(block+'\n','').replace(renderers[0][0],oldHomeToggle);
  const footer=home.match(/<footer\b[\s\S]*?<\/footer>/)[0];
  for(const label of ['데이터','가이드','운영'])assert.equal(footer.split('<h2>'+label+'</h2>').length-1,1,'footer-only heading change');
  for(const [after,before]of homeLayoutPairs){
    assert.equal(home.split(after).length-1,1,'one exact home layout/semantic change');
    if (!after.includes(before)) assert.equal(home.split(before).length-1,0,'no stale home layout/semantic change');
    normalized=normalized.replace(after,before);
  }
  return normalized;
}

function assertOriginalHome(home) {
  const block = `  /* 홈 헤더 전용: 포인터 종류와 관계없이 모바일 조작 영역 확보 */
  @media(max-width:980px){
    .topbar-inner .brand,nav.main a,.topbar-inner .login-google{min-height:44px;min-width:44px;display:inline-flex;align-items:center}
    .topbar-inner .login-google{height:auto}
    .topbar-inner .search{height:auto;min-height:46px;padding:0 10px}
    .topbar-inner .search input{min-height:44px;min-width:0}
  }
  .topbar-inner .search:focus-within{outline:2px solid var(--up);outline-offset:3px}
`;
  home = normalizeHomePerformance(normalizeHomeLayout(home));
  assert.equal(home.split(block).length, 2, 'only the exact reviewed header block may be excluded');
  assert.equal(hash(home.replace(block, '')), 'c4afeb8c4f9117263f8f086f01a92415da3327c89b6208fcf8db8d98dee57983', 'body, ads, scripts, prices and metadata remain unchanged');
}

test('home retains its original digest after exact approved header/font/defer/three-node contrast normalization', () => {
  assertOriginalHome(read('index.html'));
});

test('home folding normalization rejects scope expansion, duplicate owners, moved bootstrap and data or semantic drift', () => {
  const home=read('index.html');
  const block=home.match(/<!-- CARDPICK_HOME_PRICE_LAYOUT_START -->[\s\S]*?<!-- CARDPICK_HOME_PRICE_LAYOUT_END -->/)[0];
  const cases=[
    home.replace(block,''),
    home.replace(block,block+'\n'+block),
    home.replace(block+'\n','').replace('</head>',block+'\n</head>'),
    home.replace(':nth-child(n+6)',':nth-child(n+5)'),
    home.replace('html.cp-home-prices-folded #priceBody','html.cp-home-prices-folded table'),
    home.replace("document.addEventListener('click', function(event){", "document.addEventListener('click', function(event){\n    window.unapproved = true;"),
    home.replace('cards.slice(0, 5)','cards.slice(0, 20)'),
    home.replace('homePriceLayout.count = cards.length','homePriceLayout.count = 50'),
    home.replace('homePriceLayout.restoreFocus(previousFocus)','homePriceLayout.restoreFocus(null)'),
    home.replace('class="brand" aria-label="카드픽 CARDPICK 홈"','class="brand" aria-label="카드픽 홈"'),
    home.replace('        <h2>데이터</h2>','        <h4>데이터</h4>'),
    home.replace('        <h2>운영</h2>','        <h2>운영</h2>\n        <h2>운영</h2>'),
    home.replace('.foot h2{font-size:11px;','.foot h2{font-size:22px;'),
    home.replace("price: '₩' + Math.round(c.krw)","price: '₩' + Math.round(999999)"),
  ];
  for(const changed of cases){assert.notEqual(changed,home);assert.throws(()=>assertOriginalHome(changed),{code:'ERR_ASSERTION'});}
});

test('home normalization rejects altered, duplicate, missing or moved fonts and unrelated page/advertising changes', () => {
  const home = read('index.html');
  const fontBlock = home.match(/<style id="home-font-css">[\s\S]*?<\/style>/)[0];
  const resource = fontBlock;
  const cases = [
    ['regressing font preload reintroduced', home.replace(fontBlock, '<link rel="preload" href="/fonts/cardpick-text/home.woff2" as="font" type="font/woff2" crossorigin>\n' + fontBlock)],
    ['font CSS injection', home.replace(fontBlock, fontBlock.replace('</style>', 'body{display:none}</style>'))],
    ['font source changed', home.replace('/fonts/cardpick-text/home.woff2', '/fonts/cardpick-text/card.woff2')],
    ['late font swap', home.replace('font-display:optional', 'font-display:swap')],
    ['missing fonts', home.replace(resource, '')],
    ['duplicate fonts', home.replace(resource, resource + '\n' + resource)],
    ['fonts moved into body', home.replace(resource, '').replace('</body>', resource + '\n</body>')],
    ['fonts moved within head', home.replace(resource, '').replace('</head>', resource + '\n</head>')],
    ['login/search alias removed', home.replace('#cp-user-menu,#cp-search-results', '#cp-user-menu')],
    ['classic auth restored', home.replace('<script defer src="/auth.js?v=v3clean">', '<script src="/auth.js?v=v3clean">')],
    ['deferred scripts reordered', home.replace(homeReplacements[3][0], homeReplacements[3][0].split('\n').reverse().join('\n'))],
    ['contrast reverted', home.replace(homeReplacements[2][0], homeReplacements[2][1])],
    ['global dim changed', home.replace('--dim:#5B6577', '--dim:#8B96A8')],
    ['unrelated body injected', home.replace('</body>', '<p>unapproved</p></body>')],
    ['canonical changed', home.replace('rel="canonical" href="https://cardpick.kr/"', 'rel="canonical" href="https://cardpick.kr/catalog"')],
    ['ad slot changed', home.replace('class="adsbygoogle cp_ad_home"', 'class="adsbygoogle unapproved_home"')],
    ['executable ad SDK added', home.replace('</head>', '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script></head>')],
  ];
  for (const [name, changed] of cases) {
    assert.ok(changed !== home, `${name}: fixture must change`);
    assert.throws(() => assertOriginalHome(changed), { code: 'ERR_ASSERTION' }, name);
  }
});

test('home edge cache changes only its reviewed resource version', () => {
  const middleware = read('functions/_middleware.js');
  const newKey = '__home_ssr_v17_home_price_layout';
  const oldKey = '__home_ssr_v15_manual_ads_fonts_restored';
  function assertCache(value) {
    assert.equal(value.split(newKey).length - 1, 1);
    assert.equal(value.split(oldKey).length - 1, 0);
    assert.equal(hash(value.replace(newKey, oldKey)), '6301cdea860daf351c9289f8ea6b4048a12683ba45e3dd68a16b0571f342d7a7');
  }
  assertCache(middleware);
  for (const changed of [middleware.replace(newKey, oldKey), middleware + '\n//' + newKey, middleware.replace('limit=120', 'limit=200')]) {
    assert.notEqual(changed, middleware);
    assert.throws(() => assertCache(changed), { code: 'ERR_ASSERTION' });
  }
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
