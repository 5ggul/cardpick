// Exercise the shipped adapter and the actual existing calculator scripts.
// DOM/clipboard fixtures only; no browser network, accounts, SDKs or storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const read = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source = read('js/cp-tool-results.js');
const context = {URLSearchParams};
vm.runInNewContext(source,context,{timeout:2000});
const api = context.CardpickToolResults;
const files = {psa:'psa-grading-break-even',grading:'grading-cost-compare',overseas:'overseas-card-cost'};
const sha = text => createHash('sha256').update(text).digest('hex');
const beforeHashes = {
  psa:'5bd2bf41adeec677dfebda2b31d002a0f33ad3c9038620c334191eb4de22fec2',
  grading:'3ec934ed7ad4d546b67f6ebecb63355f2a93f5711039d34df9e58bbbfe5500c1',
  overseas:'e38bc0ab9e428e7b17b41e9cce9bac27309602794452038656376824fd069924',
};
const calculatorHashes = {
  psa:'54766ef6d4cc5a734280708e56e01881f6c045673420885f4d6d7c973afbdf98',
  grading:'c7d061951aa3d5be0d3bcfe71d0a20d0cd24593e00c9ff4fce6bdf7d4bd4d397',
  overseas:'7377292c579bb2294a3bad8a36f2322b3f2ad36ce2f0f329d13b1a5b63e9dc8f',
};
const panelHashes = {
  psa:'2cab9b93cd0a48d38cd204922d3f22d182e140f73fd7bc8cd0ab516da7ef4ded',
  grading:'28f579ba8eaf2718193f6553815471f821f0336ea11078a4b7504d1df18e7416',
  overseas:'d16b7a9ebee8ec3ccc4d718a3f22f02d12f506629fa522cad9b7d11687053bb7',
};
const assets = '<!-- calculator-results assets -->\n<link rel="stylesheet" href="/styles/tool-results.css">\n<script src="/js/cp-tool-results.js" defer></script>\n';
const pngButton = '        <!-- calculator-png button start -->\n        <button type="button" data-results-action="save-png" disabled>입력값·계산 결과 PNG 저장</button>\n        <!-- calculator-png button end -->\n';
const pngFallback = '      <!-- calculator-png fallback start -->\n      <p class="cp-results-note">PNG에도 입력한 금액과 계산 조건이 포함됩니다. 저장한 이미지를 공유하기 전에 내용을 확인하세요. 이름·사진·계정 정보는 넣지 않으며, 이미지 생성은 브라우저 안에서만 처리합니다.</p>\n      <div class="cp-results-png" data-results="png-fallback" hidden>\n        <p>저장이 시작되지 않으면 아래 링크를 눌러 저장하세요. 기기에서 다운로드를 지원하지 않으면 미리보기 이미지를 열어 직접 저장할 수 있습니다.</p>\n        <span data-results="png-link"></span>\n        <details data-results="png-details"><summary>만든 PNG 미리보기</summary><img data-results="png-image" alt="입력 조건과 계산 결과, 주의사항을 담은 PNG 미리보기"></details>\n      </div>\n      <!-- calculator-png fallback end -->\n';
const pngLabel = '<input type="checkbox" data-results="include-a" disabled>복사·저장할 내용에 조건 A도 포함';
function restorePng(html) {
  assert.equal(html.split(pngButton).length-1,1);assert.equal(html.split(pngFallback).length-1,1);assert.equal(html.split(pngLabel).length-1,1);
  assert.ok(html.includes('        <button type="button" data-results-action="copy-link" disabled>입력 조건 포함 링크 복사</button>\n'+pngButton));
  assert.ok(html.includes(pngFallback+'      <section data-results="preview" hidden aria-labelledby="cp-results-preview-title">'));
  return html.replace(pngButton,'').replace(pngFallback,'').replace(pngLabel,'<input type="checkbox" data-results="include-a" disabled>복사할 내용에 조건 A도 포함');
}
function normalizeMarkup(html,tool) {
  html=restorePng(html);
  assert.equal(html.split(assets).length-1,1);
  assert.ok(html.includes(assets+'</head>'));
  const panels = [...html.matchAll(new RegExp('    <!-- calculator-results start: '+tool+' -->[\\s\\S]*?    <!-- calculator-results end: '+tool+' -->\\n','g'))];
  assert.equal(panels.length,1); assert.equal(sha(panels[0][0]),panelHashes[tool]);
  assert.ok(html.includes(panels[0][0]+(tool==='overseas' ? '    <article class="content">' : '<!-- 카드픽 공유 -->')));
  let normalized = html.replace(assets,'').replace(panels[0][0],'');
  if (tool !== 'overseas') {
    const url = 'https://cardpick.kr/tools/'+files[tool];
    const button = `onclick="cpShare({url:'${url}'})">[ 도구 공유 ]`;
    const copy = `onclick="cpShareCopy('${url}')"`;
    assert.equal(normalized.split(button).length-1,1); assert.equal(normalized.split(copy).length-1,1);
    normalized = normalized.replace(button,`onclick="cpShare()">[ ${tool === 'psa' ? '도구 공유' : '카카오톡 공유'} ]`).replace(copy,'onclick="cpShareCopy()"');
  }
  return normalized;
}

function fixture(tool,hash = '',clipboard = true,pngOptions = {}) {
  const html = read('tools/'+files[tool]+'.html'), els = new Map(), docListeners = {}, winListeners = {}, copied = [];
  let document;
  function element(id = '',value = '') {
    const classes = new Set(), attrs = {}, listeners = {};
    const el = {id,value,type:'',mode:'',children:[],text:'',style:{},dataset:{},hidden:false,disabled:false,checked:false,selectionStart:0,
      get textContent(){return this.text+this.children.map(child => child.textContent || '').join('');},
      set textContent(value){this.text=String(value);this.children=[];},
      setAttribute(key,value){attrs[key]=String(value);},getAttribute(key){return attrs[key] ?? null;},removeAttribute(key){delete attrs[key];delete this[key];},
      addEventListener(name,fn){(listeners[name] ||= []).push(fn);},
      dispatchEvent(event){event.target ||= el;for(const fn of listeners[event.type] || [])fn(event);if(event.bubbles)for(const fn of docListeners[event.type] || [])fn(event);},
      appendChild(child){this.children.push(child);return child;},replaceChildren(...children){if(pngOptions.appendThrows && this.pngContainer && children.length)throw Error('append');this.children=children;this.text='';},
      classList:{add(...names){names.forEach(name => classes.add(name));},remove(...names){names.forEach(name => classes.delete(name));},contains(name){return classes.has(name);},toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
      focus(){document.activeElement=el;},select(){el.selected=true;},setSelectionRange(){},click(){el.clicked=(el.clicked || 0)+1;if(pngOptions.downloadThrows)throw Error('download');},
    };
    return el;
  }
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el = element(match[3],match[2].match(/\bvalue="([^"]*)"/)?.[1] || '');
    el.type = match[1] === 'select' ? 'select' : match[2].match(/\btype="([^"]*)"/)?.[1] || '';
    el.mode = match[2].match(/\binputmode="([^"]*)"/)?.[1] || '';
    els.set(el.id,el);
  }
  for (const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) els.get(match[1]).value = match[2].match(/<option value="([^"]+)"/)?.[1] || '';
  const outs = new Map([...html.matchAll(/data-out="([^"]+)"/g)].map(match => [match[1],element(match[1])]));
  const cards = ['psa','bgs','cgc','sgc'].map(co => {const el=element();el.dataset.co=co;return el;});
  const panel = element(), parts = new Map(), buttons = new Map();
  panel.setAttribute('data-cp-tool-results',tool);
  for(const match of html.matchAll(/data-results="([^"]+)"/g)) parts.set(match[1],match[1]==='fallback-text' ? els.get('cp-results-copy') : element());
  parts.get('png-link').pngContainer=true;
  for(const match of html.matchAll(/data-results-action="([^"]+)"/g)) buttons.set(match[1],element());
  panel.querySelector = selector => selector.startsWith('[data-results-action=') ? buttons.get(selector.match(/"([^"]+)"/)[1]) : parts.get(selector.match(/"([^"]+)"/)[1]);
  const drawn=[],canvases=[],created=[],revoked=[],timers=new Map();let nextTimer=0;
  document = {
    activeElement:null,getElementById(id){return els.get(id) || null;},
    createElement(kind){
      if(kind!=='canvas')return element();
      const ctx={measureText(text){return {width:Array.from(text).length*28};},fillRect(){},fillText(text,x,y){drawn.push({text,x,y,font:ctx.font});}};
      const canvas={width:300,height:150,getContext(){return pngOptions.contextMissing ? null : ctx;},toBlob(callback){
        canvas.callback=callback;
        if(pngOptions.blobThrows)throw Error('blob');
        if(!pngOptions.pending)callback(Object.hasOwn(pngOptions,'blob') ? pngOptions.blob : {type:'image/png',size:2048});
      }};
      canvases.push(canvas);return canvas;
    },
    querySelector(selector){if(selector==='[data-cp-tool-results]')return panel;return outs.get(selector.match(/data-out="([^"]+)"/)?.[1]);},
    querySelectorAll(selector){
      if(selector==='[data-out]')return [...outs.values()];
      if(selector==='.co-card')return cards;
      return [...els.values()].filter(el => selector==='input[inputmode="numeric"]' ? el.mode==='numeric' : selector==='input[type="text"][inputmode="numeric"]' ? el.type==='text' && el.mode==='numeric' : selector==='input[inputmode="decimal"]' ? el.mode==='decimal' : el.mode==='decimal' || el.type==='number' || el.type==='select');
    },
    addEventListener(name,fn){(docListeners[name] ||= []).push(fn);},
  };
  const win = {document,location:{hash},navigator:{clipboard:clipboard ? {writeText:async text => copied.push(text)} : undefined},
    URL:pngOptions.urlMissing ? undefined : {createObjectURL(blob){if(pngOptions.urlThrows)throw Error('URL');const url='blob:local-'+(created.length+1);created.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    Event:class{constructor(type,options){this.type=type;this.bubbles=options?.bubbles;}},
    addEventListener(name,fn){(winListeners[name] ||= []).push(fn);},
  };
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('function recalc()'));
  vm.runInNewContext(code,{document},{timeout:2000});
  api.mount(win);
  return {win,document,els,outs,parts,buttons,copied,code,drawn,canvases,created,revoked,timers,
    current:() => api.snapshot(document,tool),
    set(id,value){const el=els.get(id);el.value=String(value);el.dispatchEvent(new win.Event(id==='i-currency' ? 'change' : 'input',{bubbles:true}));},
    click(action){buttons.get(action).dispatchEvent(new win.Event('click'));},
    example(id='btnExample'){els.get(id).dispatchEvent(new win.Event('click'));},
    hash(value){win.location.hash=value;for(const fn of winListeners.hashchange || [])fn();},
    event(name){for(const fn of winListeners[name] || [])fn();},
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
const nextTick = () => new Promise(resolve => setImmediate(resolve));

for (const tool of Object.keys(files)) {
  test(tool+': only approved assets/panel/page-share URLs change; calculator bytes and full previous document survive',() => {
    const html = read('tools/'+files[tool]+'.html'), code = fixture(tool).code;
    assert.equal(sha(code),calculatorHashes[tool]);
    assert.equal(sha(normalizeMarkup(html,tool)),beforeHashes[tool]);
    for(const changed of [html.replace('rel="canonical"','rel="wrong"'),html.replace('name="robots"','name="wrong"'),html.replace('</body>','<script>unapproved()</script></body>')]) assert.notEqual(sha(normalizeMarkup(changed,tool)),beforeHashes[tool]);
    const panel=html.match(/    <!-- calculator-results start:[\s\S]*?    <!-- calculator-results end:[^\n]*\n/)[0];
    for(const changed of [html.replace(panel,panel+panel),html.replace(panel,panel.replace('확인한 조건 적용','자동으로 적용')),html.replace(assets,assets+assets)]) assert.throws(() => normalizeMarkup(changed,tool));
  });
  test(tool+': A/B ordinary numeric inputs round-trip within 2048 characters without an external destination',() => {
    const f=fixture(tool), current=f.current().inputs;
    const url=api.makeLink(tool,current,current), parsed=api.readFragment(new URL(url).hash,tool);
    assert.deepEqual(plain(parsed.current),plain(current));assert.deepEqual(plain(parsed.baseline),plain(current));
    assert.ok(new URL(url).hash.length<=api.MAX_FRAGMENT);assert.equal(new URL(url).origin,'https://cardpick.kr');
    assert.equal(new URL(url).pathname,'/tools/'+files[tool]);
    assert.equal(new URL(url).search,'');
  });
  test(tool+': incoming values are preview-only, require explicit apply, and do not alter the URL',() => {
    const original=fixture(tool), values={...original.current().inputs};
    const id=tool==='psa' ? 'i-ship' : tool==='grading' ? 'i-ship' : 'i-intl';values[id]='31000';
    const hash=new URL(api.makeLink(tool,values)).hash, receiver=fixture(tool,hash);
    assert.notEqual(receiver.els.get(id).value,'31000');assert.equal(receiver.parts.get('preview').hidden,false);
    receiver.click('apply');assert.equal(receiver.current().inputs[id],'31000');assert.equal(receiver.win.location.hash,hash);
    assert.equal(receiver.parts.get('preview').hidden,true);
  });
  test(tool+': copies only on explicit clicks, A inclusion is opt-in, clear does not change current input',async () => {
    const f=fixture(tool);assert.equal(f.copied.length,0);
    f.click('save-a');assert.equal(f.parts.get('comparison').hidden,false);
    assert.equal(Boolean(f.parts.get('include-a').checked),false);
    f.click('copy-link');await nextTick();assert.equal(api.readFragment(new URL(f.copied.at(-1)).hash,tool).baseline,null);
    f.parts.get('include-a').checked=true;f.click('copy-link');await nextTick();assert.ok(api.readFragment(new URL(f.copied.at(-1)).hash,tool).baseline);
    f.click('copy-result');await nextTick();assert.match(f.copied.at(-1),/입력 조건[\s\S]*계산 결과/);assert.match(f.copied.at(-1),/조건 A[\s\S]*현재 조건 B/);
    const before=JSON.stringify(f.current().inputs);f.click('clear-a');assert.equal(JSON.stringify(f.current().inputs),before);assert.equal(f.parts.get('comparison').hidden,true);
  });
  test(tool+': invalid current inputs cannot copy stale results or overwrite A',async () => {
    const f=fixture(tool);f.click('save-a');f.set(tool==='psa' ? 'i-p10' : 'i-fx','');
    assert.equal(f.buttons.get('copy-result').disabled,true);assert.equal(f.buttons.get('copy-link').disabled,true);assert.equal(f.buttons.get('save-a').disabled,true);
    f.click('copy-result');f.click('copy-link');await nextTick();assert.equal(f.copied.length,0);assert.equal(f.parts.get('comparison').hidden,false);
  });
  test(tool+': clipboard denial exposes selectable manual text without pretending copy succeeded',async () => {
    const f=fixture(tool,'',false);f.click('copy-result');await nextTick();
    assert.equal(f.parts.get('fallback').hidden,false);assert.match(f.parts.get('fallback-text').value,/입력 조건/);assert.equal(f.parts.get('fallback-text').selected,true);assert.match(f.parts.get('status').textContent,/자동 복사/);
  });
  test(tool+': malicious/duplicate/missing/oversized/different-tool fields are rejected before applying',() => {
    const f=fixture(tool), url=api.makeLink(tool,f.current().inputs), hash=new URL(url).hash;
    for(const bad of [hash+'&tool='+tool,hash+'&b.i-fx=1',hash+'&__proto__=x',hash+'&constructor=x',hash+'&next=https%3A%2F%2Fevil.example',hash.replace('cpcalc=1','cpcalc=2'),hash.replace('tool='+tool,'tool=constructor'),hash.replace('tool='+tool,'tool='+Object.keys(files).find(other=>other!==tool)),hash.replace(/&b\.[^&]+/,''),hash+'&oops=%ZZ','#cpcalc='+('x'.repeat(2048))]) assert.throws(() => api.readFragment(bad,tool),bad.slice(0,60));
    const changed=new URL(url);changed.hash=changed.hash.replace(/(b\.i-(?:raw|qty|card)=)[^&]*/, '$1%3Cimg%20onerror%3Dalert(1)%3E');assert.throws(() => api.readFragment(changed.hash,tool));
    assert.equal(api.readFragment('#cost',tool),null);
    const before=JSON.stringify([...f.els].map(([id,el])=>[id,el.value]));f.hash(hash+'&__proto__=x');
    assert.equal(JSON.stringify([...f.els].map(([id,el])=>[id,el.value])),before);assert.equal(f.parts.get('preview').hidden,true);
  });
}
test('shared reproduction retains the actual PSA shipping/fee formula and safe decimal rejection',() => {
  const f=fixture('psa');assert.equal(f.els.get('oCost').textContent,'₩ 550,000');
  const values={...f.current().inputs,'i-ship':'21000'};api.applyPackage(f.win,'psa',{current:values});assert.equal(f.els.get('oCost').textContent,'₩ 551,000');
  for(const invalid of ['1.5','1e3','12,34','NaN','9007199254740992'])assert.throws(()=>api.makeLink('psa',{...values,'i-raw':invalid}));
});
test('shared reproduction retains actual USD/EUR costs, active currency cache, and manual tax exclusion',() => {
  const f=fixture('overseas');assert.equal(f.els.get('o-landed').textContent,'₩ 205,715');
  f.example('btnEurope');const eu=f.current();assert.equal(f.els.get('o-landed').textContent,'₩ 197,222');
  f.example();const us=f.current();api.applyPackage(f.win,'overseas',{current:eu.inputs,baseline:us.inputs});assert.equal(f.els.get('o-landed').textContent,'₩ 197,222');
  f.set('i-currency','USD');assert.equal(f.els.get('i-fx').value,'1380');f.set('i-currency','EUR');assert.equal(f.els.get('i-fx').value,'1500');
  const off={...eu.inputs,'i-tax-mode':'off'};api.applyPackage(f.win,'overseas',{current:off});assert.match(f.els.get('o-tax-note').textContent,/면세 판정이 아니/);assert.equal(f.els.get('o-tax').textContent,'₩ 0');
});
test('unsafe derived values roll back all applied fields and existing results',() => {
  const f=fixture('psa'), before=plain(f.current());
  const values={...before.inputs,'i-raw':String(Number.MAX_SAFE_INTEGER)};
  assert.throws(()=>api.applyPackage(f.win,'psa',{current:values,baseline:before.inputs}));assert.deepEqual(plain(f.current()),before);
});
test('failed overseas A/B application restores the previous other-currency FX cache too',()=>{
  const f=fixture('overseas');f.set('i-currency','EUR');f.set('i-fx','1500');f.set('i-usd-fx','1380');
  const before=plain(f.current());
  const baseline={...before.inputs,'i-currency':'USD','i-fx':'999'};
  const unsafe={...before.inputs,'i-card':String(Number.MAX_SAFE_INTEGER),'i-fx':String(Number.MAX_SAFE_INTEGER)};
  assert.throws(()=>api.applyPackage(f.win,'overseas',{current:unsafe,baseline}));
  assert.deepEqual(plain(f.current()),before);
  f.set('i-currency','USD');assert.equal(f.els.get('i-fx').value,'1380');
  f.set('i-currency','EUR');assert.equal(f.els.get('i-fx').value,'1500');
});
test('ignored fields cannot smuggle script text, partial A or overlong values into a condition link',()=>{
  const f=fixture('overseas'), current=f.current().inputs;
  const link=api.makeLink('overseas',current), hash=new URL(link).hash;
  assert.throws(()=>api.readFragment(hash.replace('b.i-usd-fx=','b.i-usd-fx=%3Cscript%3E'), 'overseas'));
  assert.throws(()=>api.readFragment(hash+'&a.i-market=other','overseas'));
  assert.throws(()=>api.readFragment(hash.replace(/(b\.i-card=)[^&]*/,'$1'+'1'.repeat(49)),'overseas'));
  assert.throws(()=>api.makeLink('overseas',{...current,'i-fx':'0x10'}));
  const params=new URLSearchParams(hash.slice(1));params.append('b%2Ei-card','120');
  assert.throws(()=>api.readFragment('#'+params,'overseas'));
});
test('grading reproduction preserves blank-company exclusion, ties, direct mode and SGC policy',() => {
  const f=fixture('grading'), values={...f.current().inputs,'g-bgs':'32.99','g-cgc':'','g-sgc':'15','i-mode':'direct'};
  api.applyPackage(f.win,'grading',{current:values});assert.equal(f.outs.get('total-psa').textContent,'₩ 196,678');assert.equal(f.outs.get('total-cgc').textContent,'미입력');
  assert.match(f.els.get('o-best-name').textContent,/PSA · BGS.*동률/);assert.equal(f.current().outputs.some(row=>row.key==='total-sgc'),true);
});
test('a company omitted from valid B is comparison-excluded, not an invalid calculation',()=>{
  const f=fixture('grading');f.click('save-a');f.set('g-cgc','');
  assert.equal(f.buttons.get('copy-result').disabled,false);
  assert.match(f.parts.get('comparison-table').textContent,/CGC 총 비용[\s\S]*미입력\/비교 제외/);
  assert.doesNotMatch(f.parts.get('comparison-table').textContent,/입력 확인/);
  f.set('i-fx','');assert.match(f.parts.get('comparison-table').textContent,/입력 확인/);
});
test('apply and dismiss return keyboard focus from a hidden preview to a visible action or status',()=>{
  const original=fixture('psa'), hash=new URL(api.makeLink('psa',original.current().inputs)).hash;
  const applied=fixture('psa',hash);applied.buttons.get('apply').focus();applied.click('apply');
  assert.equal(applied.parts.get('preview').hidden,true);
  assert.equal(applied.document.activeElement,applied.buttons.get('copy-result'));
  assert.equal(applied.document.activeElement.disabled,false);
  const dismissed=fixture('psa',hash);dismissed.buttons.get('dismiss').focus();dismissed.click('dismiss');
  assert.equal(dismissed.parts.get('preview').hidden,true);
  assert.equal(dismissed.document.activeElement,dismissed.buttons.get('copy-result'));
  const invalid=fixture('psa',hash);invalid.set('i-p10','');invalid.buttons.get('dismiss').focus();invalid.click('dismiss');
  assert.equal(invalid.document.activeElement,invalid.parts.get('status'));
  assert.equal(invalid.parts.get('status').getAttribute('tabindex'),'-1');
  assert.match(invalid.parts.get('status').textContent,/기존 입력값을 유지/);
});
test('adapter has no network/storage/analytics/SDK/eval/URL-write path and CSS is panel-owned',() => {
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|gtag|eval)\s*(?:\.|\()/);
  assert.doesNotMatch(source,/innerHTML|cpShare\s*\(|Kakao|location\.(?:href|hash)\s*=|history\.(?:pushState|replaceState)/);
  const css=read('styles/tool-results.css');assert.doesNotMatch(css,/@import|url\(|!important|overflow-x:hidden/);
  assert.match(css,/\.cp-tool-results\{[^}]*padding:20px/);assert.match(css,/@media\(max-width:720px\)\{\.cp-tool-results\{padding:16px/);assert.match(css,/min-height:44px/);assert.match(css,/:focus-visible/);
  for(const selector of css.split('{').slice(0,-1).map(part=>part.split('}').at(-1).trim()).filter(selector=>!selector.startsWith('@media')))assert.ok(selector.includes('.cp-tool-results'),selector);
});

for(const tool of Object.keys(files)) {
  test(tool+': no inactive PNG anchor exists before generation or after invalidation',async()=>{
    const html=read('tools/'+files[tool]+'.html');
    const fallback=html.match(/<!-- calculator-png fallback start -->[\s\S]*?<!-- calculator-png fallback end -->/)[0];
    assert.doesNotMatch(fallback,/<a\b/);assert.match(fallback,/<span data-results="png-link"><\/span>/);
    const f=fixture(tool);assert.equal(f.parts.get('png-link').children.length,0);
    f.click('save-png');await nextTick();assert.equal(f.parts.get('png-link').children.length,1);
    f.event('pagehide');assert.equal(f.parts.get('png-link').children.length,0);assert.equal(f.revoked.length,1);
  });
  test(tool+': PNG uses current allowed inputs, displayed results, every note and fixed canonical only',async()=>{
    const f=fixture(tool), expected=api.textResult(tool,f.current(),null);
    assert.equal(f.canvases.length,0,'no eager canvas work');
    f.click('save-png');assert.equal(f.buttons.get('save-png').disabled,true);
    await nextTick();
    assert.equal(f.created.length,1);assert.equal(f.parts.get('png-fallback').hidden,false);
    assert.equal(f.parts.get('png-link').children.length,1);
    const link=f.parts.get('png-link').children[0];
    assert.equal(link.download,'cardpick-'+tool+'-calculation.png');assert.match(link.href,/^blob:/);
    assert.equal(link.textContent,'PNG 파일 저장');
    assert.equal(link.clicked,1);assert.equal(f.revoked.length,0,'URL survives automatic save initiation');
    assert.equal(f.drawn.slice(1).map(row=>row.text).join(''),expected.replaceAll('\n',''));
    assert.equal(f.canvases[0].width,0);assert.equal(f.canvases[0].height,0,'drawing memory released after Blob');
    assert.equal(f.buttons.get('save-png').disabled,false);assert.equal(f.timers.size,0);
    assert.match(f.parts.get('status').textContent,/PNG를 만들었습니다/);
    assert.doesNotMatch(expected,/#cpcalc|token=|계정 정보:/);
  });
  test(tool+': PNG condition A is opt-in and input changes dispose the old preview URL',async()=>{
    const f=fixture(tool);f.click('save-a');const a=f.current();
    const id=tool==='psa' ? 'i-raw' : tool==='grading' ? 'i-misc' : 'i-intl';
    f.set(id,'32100');f.click('save-png');await nextTick();
    assert.doesNotMatch(f.drawn.map(row=>row.text).join(''),/조건 A/);
    f.parts.get('include-a').checked=true;f.drawn.length=0;
    f.click('save-png');await nextTick();
    assert.equal(f.drawn.slice(1).map(row=>row.text).join(''),api.textResult(tool,f.current(),a).replaceAll('\n',''));
    assert.equal(f.revoked.length,1,'replaced Blob URL is revoked, new one remains');
    f.set(id,'32200');assert.equal(f.parts.get('png-fallback').hidden,true);
    assert.equal(f.revoked.length,2);assert.equal(f.parts.get('png-image').src,undefined);
    assert.equal(f.parts.get('png-link').children.length,0);
    f.click('save-png');await nextTick();f.event('pagehide');assert.equal(f.revoked.length,3);
  });
  test(tool+': invalid and oversized PNG inputs cannot create an export',async()=>{
    for(const bad of ['', '-1', '1e3', '<img>']) {
      const f=fixture(tool), id=tool==='psa' ? 'i-grade' : tool==='grading' ? 'i-fx' : 'i-card';
      f.set(id,bad);assert.equal(f.buttons.get('save-png').disabled,true);
      f.click('save-png');await nextTick();assert.equal(f.created.length,0);assert.equal(f.canvases.length,0);
    }
  });
  test(tool+': exact PNG additions do not weaken old full-document protection',()=>{
    const html=read('tools/'+files[tool]+'.html');
    for(const changed of [html.replace(pngButton,pngButton+pngButton),html.replace(pngFallback,pngFallback+pngFallback),html.replace('입력값·계산 결과 PNG 저장','자동 공유'),html.replace(pngButton,'').replace('</body>',pngButton+'</body>'),html.replace(pngFallback,'').replace('</body>',pngFallback+'</body>')])assert.throws(()=>normalizeMarkup(changed,tool));
    const changed=html.replace('PNG 미리보기','미승인 PNG 미리보기');assert.throws(()=>normalizeMarkup(changed,tool));
  });
}
test('PNG keeps scenario warnings, tax exclusions, EUR rates, direct-mode exclusions and missing-company labels',async()=>{
  const psa=fixture('psa');psa.els.get('scenarioWarn').classList.add('show');psa.els.get('scenarioWarn').textContent='예상 판매가 순서를 다시 확인하세요.';
  psa.click('save-png');await nextTick();assert.match(psa.drawn.map(row=>row.text).join(''),/예상 판매가 순서를 다시 확인하세요\./);
  const overseas=fixture('overseas');overseas.example('btnEurope');overseas.set('i-tax-mode','off');overseas.click('save-png');await nextTick();
  const text=overseas.drawn.map(row=>row.text).join('');assert.match(text,/EUR/);assert.match(text,/면세 판정이 아닙니다/);assert.match(text,/미입력 또는 이번 계산에서 제외/);
  const grading=fixture('grading');grading.set('i-mode','direct');grading.set('g-cgc','');grading.click('save-png');await nextTick();
  const gr=grading.drawn.map(row=>row.text).join('');assert.match(gr,/CGC 장당 요금: 미입력 또는 이번 계산에서 제외/);assert.doesNotMatch(gr,/CGC 총 비용:/);assert.match(gr,/장당 대행 수수료: 미입력 또는 이번 계산에서 제외/);assert.match(gr,/SGC도 비용에 표시/);
});
test('actual PSA calculator inversion warning survives snapshot, text result and PNG rendering',()=>{
  const warning='등급이 낮아질수록 예상 판매가가 높아지는 입력입니다. 카드 번호·언어판·세트와 판매 완료 가격을 다시 확인하세요.';
  for(const [id,value] of [['i-p10','500000'],['i-p9','300000']]) {
    const f=fixture('psa');
    assert.equal(f.els.get('scenarioWarn').classList.contains('show'),false);
    // fixture runs the shipped inline recalc listener; do not fabricate its warning.
    f.set(id,value);
    assert.equal(f.els.get('scenarioWarn').classList.contains('show'),true);
    assert.equal(f.els.get('scenarioWarn').textContent,warning);
    const current=f.current();assert.equal(current.notes.filter(note=>note===warning).length,1);
    const text=api.textResult('psa',current,null);assert.equal(text.split(warning).length-1,1);
    const canvas=api.renderPng(f.document,text), rendered=f.drawn.slice(1).map(row=>row.text).join('');
    assert.equal(rendered,text.replaceAll('\n',''));assert.ok(rendered.includes(warning));
    canvas.width=0;canvas.height=0;
  }
});
test('PNG wraps long Korean without dropping text and enforces measured width, height, text and pixel caps',()=>{
  const ctx={measureText:text=>({width:Array.from(text).length*28})};
  const text='한글'.repeat(250)+'\n주의사항: '+('면세 판정이 아닙니다. '.repeat(20));
  const layout=api.pngLayout(ctx,text);
  assert.equal(layout.rows.slice(1).map(row=>row.text).join(''),text.replaceAll('\n',''));
  assert.ok(layout.height<=api.PNG_LIMITS.maxHeight);assert.ok(layout.width*layout.height<=api.PNG_LIMITS.maxPixels);
  for(const row of layout.rows){assert.ok(row.x+ctx.measureText(row.text).width<=layout.width-48);assert.ok(row.y+row.lineHeight<=layout.height-48);}
  assert.throws(()=>api.pngLayout(ctx,'가'.repeat(api.PNG_LIMITS.maxText+1)));
  assert.throws(()=>api.pngLayout(ctx,'가'.repeat(12000)),'over-height does not silently crop');
  assert.throws(()=>api.pngLayout({measureText:()=>({width:Infinity})},'가'));
  assert.throws(()=>api.pngLayout({measureText:()=>({width:2000})},'가'));
});
test('PNG handles missing Canvas, Blob failure, bad MIME/size, timeout and download restrictions without false save claims',async()=>{
  for(const options of [{contextMissing:true},{blobThrows:true},{blob:null},{blob:{type:'image/jpeg',size:20}},{blob:{type:'image/png',size:0}},{blob:{type:'image/png',size:8000001}},{urlMissing:true},{urlThrows:true}]){
    const f=fixture('psa','',true,options);f.click('save-png');await nextTick();
    assert.equal(f.created.length,0);assert.match(f.parts.get('status').textContent,/PNG를 만들지 못했습니다/);assert.equal(f.buttons.get('save-png').disabled,false);
    for(const canvas of f.canvases){assert.equal(canvas.width,0);assert.equal(canvas.height,0);}
  }
  const timeout=fixture('psa','',true,{pending:true});timeout.click('save-png');for(const fn of timeout.timers.values())fn();await nextTick();assert.equal(timeout.created.length,0);assert.equal(timeout.timers.size,0);
  const fallback=fixture('psa','',true,{downloadThrows:true});fallback.click('save-png');await nextTick();assert.equal(fallback.parts.get('png-fallback').hidden,false);assert.equal(fallback.parts.get('png-link').children.length,1);assert.match(fallback.parts.get('png-link').children[0].href,/^blob:/);assert.doesNotMatch(fallback.parts.get('status').textContent,/저장 완료/);
});
test('PNG DOM preparation failure revokes its Blob and restores the available export action',async()=>{
  const f=fixture('psa','',true,{appendThrows:true});f.click('save-png');await nextTick();
  assert.equal(f.created.length,1);assert.equal(f.revoked.length,1);assert.equal(f.parts.get('png-link').children.length,0);
  assert.equal(f.parts.get('png-fallback').hidden,true);assert.equal(f.parts.get('png-image').src,undefined);
  assert.equal(f.buttons.get('save-png').disabled,false);assert.match(f.parts.get('status').textContent,/PNG를 만들지 못했습니다/);
  assert.equal(f.canvases[0].width,0);assert.equal(f.canvases[0].height,0);
});
test('PNG ignores duplicate clicks and cancels a pending export when conditions change',async()=>{
  const f=fixture('psa','',true,{pending:true});f.click('save-png');f.click('save-png');assert.equal(f.canvases.length,1);
  f.set('i-raw','41000');f.canvases[0].callback({type:'image/png',size:200});await nextTick();assert.equal(f.created.length,0);assert.equal(f.parts.get('png-fallback').hidden,true);
  const reset=fixture('psa','',true,{pending:true});reset.click('save-png');reset.example();reset.canvases[0].callback({type:'image/png',size:200});await nextTick();assert.equal(reset.created.length,0);
});
