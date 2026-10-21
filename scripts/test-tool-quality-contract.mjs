// Source/VM contracts, not a browser or grading-service certification test.
// PSA 10 approximate limits independently checked against the official page:
// https://www.psacard.com/gradingstandards (2026-10-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreGrowth17 } from './test-growth-navigation-contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = '49168b908b023ca934f574e7f7f1dcc68569dfe9';
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const before = file => execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/').replace(/\/$/, ''), 'show', base + ':' + file], {cwd: root, encoding: 'utf8'}).replaceAll('\r\n', '\n');
const resultsPanels = {
  'psa-grading-break-even':['psa','2cab9b93cd0a48d38cd204922d3f22d182e140f73fd7bc8cd0ab516da7ef4ded'],
  'overseas-card-cost':['overseas','d16b7a9ebee8ec3ccc4d718a3f22f02d12f506629fa522cad9b7d11687053bb7'],
};
// Approved growth22 PNG additions only. Restore them before every legacy hash.
function restoreCalculatorPng(source) {
  const hashes = {button:'786642380cefcd0f3343941b0f64bb548984afcd2a7427ac69730fa422463c09',
    fallback:'7f0e0b256de095d747a145ba659ae8037f119fe38d50be12d33239de0eb2bf17'};
  for (const kind of ['button','fallback']) {
    const spaces = kind === 'button' ? '        ' : '      ';
    const pattern = new RegExp(spaces+'<!-- calculator-png '+kind+' start -->\\n[\\s\\S]*?'+spaces+'<!-- calculator-png '+kind+' end -->\\n','g');
    const blocks = [...source.matchAll(pattern)];
    assert.equal(blocks.length,1,'one exact PNG '+kind+' block');
    const block=blocks[0][0];
    assert.equal(createHash('sha256').update(block).digest('hex'),hashes[kind],'reviewed PNG '+kind+' bytes');
    if (kind === 'button') {
      const anchor='        <button type="button" data-results-action="copy-link" disabled>입력 조건 포함 링크 복사</button>\\n'.replace('\\n','\n');
      assert.ok(source.slice(0,blocks[0].index).endsWith(anchor),'PNG follows the existing condition-link button');
    } else {
      assert.ok(source.slice(blocks[0].index+block.length).startsWith('      <section data-results="preview" hidden aria-labelledby="cp-results-preview-title">'),'PNG fallback precedes the existing condition preview');
    }
    source=source.replace(block,'');
  }
  const after='<input type="checkbox" data-results="include-a" disabled>복사·저장할 내용에 조건 A도 포함';
  const before='<input type="checkbox" data-results="include-a" disabled>복사할 내용에 조건 A도 포함';
  assert.equal(source.split(after).length-1,1,'one reviewed A copy/save label');
  assert.equal(source.split(before).length-1,0,'no duplicate stale A label');
  return source.replace(after,before);
}
function normalizeToolResults(source,name) {
  if (!resultsPanels[name]) return source;
  source=restoreCalculatorPng(source);
  const [tool,hash] = resultsPanels[name];
  const assets='<!-- calculator-results assets -->\n<link rel="stylesheet" href="/styles/tool-results.css">\n<script src="/js/cp-tool-results.js" defer></script>\n';
  assert.equal(source.split(assets).length-1,1,'exact approved local results assets');
  assert.ok(source.includes(assets+'</head>'),'results assets retain the approved head position');
  const panels=[...source.matchAll(new RegExp('    <!-- calculator-results start: '+tool+' -->[\\s\\S]*?    <!-- calculator-results end: '+tool+' -->\\n','g'))];
  assert.equal(panels.length,1,'exactly one approved panel');
  assert.equal(createHash('sha256').update(panels[0][0]).digest('hex'),hash,'approved panel bytes only');
  assert.ok(source.includes(panels[0][0]+(tool==='overseas' ? '    <article class="content">' : '<!-- 카드픽 공유 -->')),'approved results panel insertion point');
  let normalized=source.replace(assets,'').replace(panels[0][0],'');
  if (tool==='psa') {
    const share='onclick="cpShare({url:\'https://cardpick.kr/tools/psa-grading-break-even\'})"';
    const copy='onclick="cpShareCopy(\'https://cardpick.kr/tools/psa-grading-break-even\')"';
    assert.equal(normalized.split(share).length-1,1);assert.equal(normalized.split(copy).length-1,1);
    normalized=normalized.replace(share,'onclick="cpShare()"').replace(copy,'onclick="cpShareCopy()"');
  }
  return normalized;
}
const centering = read('tools/centering-checker.html');
const overseas = normalizeToolResults(read('tools/overseas-card-cost.html'),'overseas-card-cost');
const psa = normalizeToolResults(read('tools/psa-grading-break-even.html'),'psa-grading-break-even');
const scripts = source => [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const schemas = source => [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
const plain = source => source.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const centerDescriptionCopies = [
  ['name="description"', '포켓몬 카드 사진으로 좌우·상하 비율과 앞면 센터링 참고 범위를 비교하세요. 등급 판정 도구가 아니며 BGS 최신 공식 기준은 확인하지 못했습니다. 이미지는 브라우저에서만 처리됩니다.'],
  ['property="og:description"', '카드 사진의 좌우·상하 비율과 앞면 센터링 참고 비교. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 이미지 로컬 처리.'],
  ['name="twitter:description"', '앞면 센터링 참고 비교 도구. 등급 판정이 아니며 BGS 최신 공식 기준은 미확인입니다. 이미지는 브라우저에서만 처리됩니다.'],
];
const metaTag = (source, attribute) => [...source.matchAll(/<meta\b[^>]*>/g)].find(match => match[0].includes(attribute))?.[0];

function element(id, value = '', type = '', mode = '') {
  const attrs = new Map();
  const classes = new Set();
  return {
    id, value, type, mode, textContent: '', innerHTML: '', style: {}, hidden: false, disabled: false,
    callbacks: {}, selectionStart: 0,
    classList: {add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name)},
    addEventListener(name, fn) { (this.callbacks[name] ??= []).push(fn); },
    dispatch(name, event = {}) { for (const fn of this.callbacks[name] || []) fn({target: this, preventDefault() {}, ...event}); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name); },
    setSelectionRange() {},
  };
}

function calculator(source, marker) {
  const els = new Map();
  for (const match of source.matchAll(/<input\b([^>]+)>/g)) {
    const attrs = match[1], id = attrs.match(/id="([^"]+)"/)?.[1];
    if (id) els.set(id, element(id, attrs.match(/value="([^"]*)"/)?.[1] || '', attrs.match(/type="([^"]+)"/)?.[1] || '', attrs.match(/inputmode="([^"]+)"/)?.[1] || ''));
  }
  for (const match of source.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) els.set(match[1], element(match[1], match[2].match(/<option value="([^"]+)"/)?.[1] || '', 'select'));
  const get = id => { if (!els.has(id)) els.set(id, element(id)); return els.get(id); };
  const document = {
    getElementById: get,
    querySelectorAll(selector) {
      return [...els.values()].filter(el => selector === 'input[inputmode="numeric"]' ? el.mode === 'numeric' : el.mode === 'decimal' || el.type === 'number' || el.type === 'select');
    },
  };
  const code = scripts(source).find(script => script.includes(marker));
  assert.ok(code, 'actual page calculator script exists');
  vm.runInNewContext(code, {document}, {timeout: 2000});
  return {
    get,
    set(values, eventId = 'i-card') { for (const [id, value] of Object.entries(values)) get(id).value = String(value); get(eventId).dispatch('input'); },
    changeCurrency(value) { get('i-currency').value = value; get('i-currency').dispatch('change'); },
    click(id) { get(id).dispatch('click'); },
    number(id) { return Number(get(id).textContent.replace(/[^\d.\-]/g, '')); },
  };
}

function assertInvalid(fixture) {
  assert.ok(fixture.get('inputError').textContent.length > 0, 'invalid input must have an explanation');
  for (const id of ['o-landed', 'o-base', 'o-pay', 'o-intl', 'o-tax', 'o-buffer', 'o-break']) assert.equal(fixture.get(id).textContent, '입력 확인', 'all stale numeric outputs must be cleared');
  assert.doesNotMatch(fixture.get('o-compare').textContent, /절약|낮음|높음|Infinity|NaN/);
}

function centeringUi(source) {
  const els = new Map(), exported = [], copied = [];
  const get = id => {if (!els.has(id)) els.set(id,element(id));return els.get(id);};
  const context2d = draws => new Proxy({measureText: text => ({width:Array.from(text).length*10}),fillText: (text,x,y) => draws.push({text,x,y}),createLinearGradient: () => ({addColorStop(){}})}, {get(target,key){return key in target ? target[key] : ()=>{};}});
  const cv=get('cv');
  cv.width=100;cv.height=140;cv.getContext=()=>context2d([]);
  cv.getBoundingClientRect=()=>({left:0,top:0,width:cv.width,height:cv.height});
  const zooms=[1,1.5,2,3].map(zoom=>Object.assign(element('zoom'+zoom),{dataset:{zoom:String(zoom)}}));
  const steps=Array.from({length:8},(_,i)=>element('step'+i));
  const document={
    activeElement:null,getElementById:get,
    querySelectorAll(selector){return selector==='.zoom-btn' ? zooms : selector==='.step-cell' ? steps : [];},
    createElement(tag){
      const out=element(tag);out.click=()=>{};
      if(tag==='canvas'){out.draws=[];out.width=0;out.height=0;out.getContext=()=>context2d(out.draws);out.toDataURL=()=> 'data:image/png;base64,test';exported.push(out);}
      return out;
    },
  };
  class Image {constructor(){this.naturalWidth=100;this.naturalHeight=140;}set src(value){this._src=value;this.onload?.();}}
  const code=scripts(source).find(script=>script.includes('function compute()'));
  vm.runInNewContext(code,{document,Image,console:{log(){},warn(){}},navigator:{clipboard:{writeText:async text=>copied.push(text)}},setTimeout(){},alert: message=>{throw new Error(message);}}, {timeout:2000});
  get('btn-sample').dispatch('click');
  return {get,cv,exported,copied,focus(){document.activeElement=cv;cv.dispatch('focus');},key(key,shiftKey=false){cv.dispatch('keydown',{key,shiftKey});}};
}

function assertOptionalFonts(source) {
  const font='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=optional';
  const active='<link href="'+font+'" rel="stylesheet" media="print" onload="this.media=\'all\'">';
  const fallback='<noscript><link href="'+font+'" rel="stylesheet"></noscript>';
  assert.equal(source.split(active).length-1,1);
  assert.equal(source.split(fallback).length-1,1);
  assert.doesNotMatch(source,/VT323|family=JetBrains[^"\n]*display=swap/);
  return active+'\n'+fallback;
}

function assertCenterContent(source) {
  const faq = schemas(source).find(schema => schema['@type'] === 'FAQPage');
  const visible = [...source.matchAll(/<div class="faq-q">([\s\S]*?)<\/div>\s*<div class="faq-a">([\s\S]*?)<\/div>/g)].map(match => ({name: plain(match[1]), answer: plain(match[2])}));
  assert.equal(visible.length, faq.mainEntity.length);
  faq.mainEntity.forEach((question, index) => assert.deepEqual(visible[index], {name: question.name, answer: question.acceptedAnswer.text}));
  assert.match(source, /href="https:\/\/www\.psacard\.com\/gradingstandards"/);
  assert.match(faq.mainEntity[1].acceptedAnswer.text, /앞면 약 55\/45 이내, 뒷면 약 75\/25 이내/);
  assert.match(faq.mainEntity[1].acceptedAnswer.text, /근사 허용치/);
  assert.match(faq.mainEntity[2].acceptedAnswer.text, /최신 BGS 공식 합격 기준으로 확인하지 못했습니다/);
  assert.match(faq.mainEntity[5].acceptedAnswer.text, /결과 표는 앞면 기준만 비교합니다/);
  assert.doesNotMatch(source, /PSA 공식 발표가 아닌|위 수치는 공식 발표가 아닌/);
  assert.match(source, /앞면 센터링 참고 비교 \(등급 판정 아님\)/);
  for (const [attribute, description] of centerDescriptionCopies) assert.equal(metaTag(source, attribute), '<meta ' + attribute + ' content="' + description + '">');
  const app = schemas(source).find(schema => schema['@type'] === 'WebApplication');
  const howTo = schemas(source).find(schema => schema['@type'] === 'HowTo');
  assert.match(app.description, /앞면 센터링 참고 범위를 비교/);
  assert.match(app.description, /등급 판정이 아니며 BGS 최신 공식 기준은 미확인/);
  assert.ok(app.featureList.includes('PSA 10·9·8 앞면 센터링 참고 비교 (등급 판정 아님)'));
  assert.ok(app.featureList.includes('BGS 10 Pristine·9.5 참고 비교 (최신 공식 기준 미확인)'));
  assert.match(howTo.description, /앞면 센터링 참고 비교/);
  assert.match(howTo.description, /등급 판정이 아니며 BGS 최신 공식 기준은 미확인/);
  const fifth = howTo.step.find(step => step.position === 5).text;
  const visibleFifth = source.match(/<li><strong>5단계:<\/strong> ([\s\S]*?)<\/li>/)?.[1];
  assert.equal(visibleFifth, fifth, 'rendered final step and HowTo must describe the same feature');
  assert.match(fifth, /앞면 센터링 참고 비교/);
  assert.match(fifth, /등급 판정이 아니며 BGS 최신 공식 기준은 미확인/);
  assert.doesNotMatch(source, /(?:통과|등급) 가능성|기준 통과 여부/);
}

function measure(source, horizontalPercent) {
  const code = scripts(source).find(script => script.includes('function compute()'));
  const compute = code.slice(code.indexOf('  function compute(){'), code.indexOf('  // ===== 복사 ====='));
  const els = new Map();
  const document = {getElementById(id) { if (!els.has(id)) els.set(id, element(id)); return els.get(id); }};
  const left = horizontalPercent / 5, right = 100 - (20 - left);
  const context = {document, inputPoints: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:left,y:10},{x:right,y:10},{x:right,y:90},{x:left,y:90}], alert: message => {throw new Error(message);}};
  vm.runInNewContext('const points = inputPoints; let lastResult; const resultEl = {style:{}}; const copyPreview = {};\n' + compute + '\ncompute(); globalThis.measureResult = lastResult;', context, {timeout: 2000});
  return {result: context.measureResult, rows: document.getElementById('grade-list').innerHTML};
}

test('centering official approximate source, front-only scope and visible FAQ match', () => assertCenterContent(centering));

test('centering geometry, integer rounding and reference cutoffs retain the reviewed algorithm', () => {
  const old = before('tools/centering-checker.html');
  const geometry = source => scripts(source).find(script => script.includes('function compute()')).split('  function compute(){')[1].split('    const grades = [')[0];
  assert.equal(geometry(centering), geometry(old));
  for (const cutoff of [50, 51, 55, 56, 60, 61, 65, 66]) {
    const actual = measure(centering, cutoff), baseline = measure(old, cutoff);
    assert.equal(actual.result.lr, baseline.result.lr);
    assert.equal(actual.result.tb, baseline.result.tb);
    assert.deepEqual([...actual.rows.matchAll(/class="(pass|fail)"/g)].map(match => match[1]), [...baseline.rows.matchAll(/class="(pass|fail)"/g)].map(match => match[1]));
    assert.match(actual.result.passLine, /앞면 참고 비교/);
    assert.match(actual.result.passLine, /등급 판정 아님/);
  }
  assert.match(measure(centering, 50).result.text, /공식 미확인 참고값/);
});

test('centering contracts reject a hidden-only FAQ edit and a changed cutoff', () => {
  assert.throws(() => assertCenterContent(centering.replace('"text": "PSA 공식 등급 기준은 앞면 약 55/45 이내', '"text": "PSA 공식 등급 기준은 앞면 약 99/1 이내')));
  const changed = centering.replace("cutoff:55, note:'앞면 약 55/45", "cutoff:99, note:'앞면 약 55/45");
  assert.notEqual(measure(changed, 56).rows, measure(centering, 56).rows, 'cutoff mutation changes the actual result and must not be normalized away');
});

test('centering contracts reject unsupported probability claims in metadata, schema and instructions', () => {
  for (const changed of [
    centering.replace('앞면 센터링 참고 범위를 비교하세요.', 'PSA 10·BGS 10 통과 가능성을 확인하세요.'),
    centering.replace('"description":"포켓몬 카드 사진의 좌우·상하 비율과 앞면 센터링 참고 범위를 비교하는 도구.', '"description":"PSA 10·BGS 10 통과 가능성을 계산하는 도구.'),
    centering.replace('"PSA 10·9·8 앞면 센터링 참고 비교 (등급 판정 아님)"', '"PSA 10·9·8 기준 통과 여부 표시"'),
    centering.replace('"description":"카드 이미지를 업로드해 외곽 4점과 내부 4점을 클릭하면 좌우·상하 비율과 앞면 센터링 참고 비교를 확인합니다.', '"description":"PSA/BGS 기준 통과 가능성을 즉시 계산합니다.'),
    centering.replace('<li><strong>5단계:</strong> 좌우·상하 비율과 앞면 센터링 참고 비교를 확인합니다.', '<li><strong>5단계:</strong> PSA·BGS 등급 통과 가능성이 자동으로 표시됩니다.'),
  ]) {
    assert.notEqual(changed, centering);
    assert.throws(() => assertCenterContent(changed));
  }
});

test('centering accessible upload, 44px controls, inline links and keyboard instructions have focused styles',()=>{
  assert.doesNotMatch(centering,/input\[type=file\]\{display:none/);
  assert.match(centering,/<input type="file"[^>]+>\s*<label class="btn" for="file-input">/);
  assert.match(centering,/#file-input:focus-visible \+ label/);
  assert.match(centering,/\.term-inner \.btn,\.term-inner \.zoom-btn\{min-height:44px;min-width:44px/);
  assert.match(centering,/\.content p a\{[^}]*text-decoration:underline/);
  assert.match(centering,/\.ext-links a\{[^}]*min-height:44px/);
  assert.match(centering,/<canvas id="cv" tabindex="0"[^>]*aria-describedby="keyboard-help"/);
});

test('centering actual keyboard interaction selects eight points and retains pointer ratios',()=>{
  const fixture=centeringUi(centering);fixture.focus();
  let x=50,y=70;
  const moveTo=(tx,ty)=>{
    while(x!==tx){const delta=tx-x,large=Math.abs(delta)>=10;fixture.key(delta>0?'ArrowRight':'ArrowLeft',large);x+=Math.sign(delta)*(large?10:1);}
    while(y!==ty){const delta=ty-y,large=Math.abs(delta)>=10;fixture.key(delta>0?'ArrowDown':'ArrowUp',large);y+=Math.sign(delta)*(large?10:1);}
    fixture.key('Enter');
  };
  for(const [tx,ty] of [[10,10],[90,10],[90,130],[10,130],[20,20],[80,20],[80,120],[20,120]])moveTo(tx,ty);
  assert.equal(fixture.get('lr-val').textContent,'50/50');
  assert.equal(fixture.get('tb-val').textContent,'50/50');
  assert.equal(fixture.get('result-section').style.display,'block');
  assert.match(fixture.get('keyboard-status').textContent,/8점 선택 완료/);
  const copy=fixture.get('copy-preview').textContent;
  fixture.key('Enter');assert.equal(fixture.get('copy-preview').textContent,copy,'a ninth point is ignored');
  fixture.get('btn-download').dispatch('click');
  const png=fixture.exported.at(-1);
  assert.equal(png.width,320,'small uploaded images retain room for readable result text');
  assert.ok(png.height>140+90+48,'the result area grows to fit wrapped caveats');
  assert.ok(png.draws.length>3);
  for(const draw of png.draws){assert.ok(Array.from(draw.text).length*10<=png.width-48);assert.ok(draw.y<png.height-24);}
});

test('overseas USD and EUR explanation-only examples retain their calculated totals', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  assert.equal(fixture.number('o-landed'), 205715);
  assert.equal(fixture.get('inputError').textContent, '');
  fixture.click('btnEurope');
  assert.equal(fixture.number('o-landed'), 197222);
  assert.equal(fixture.number('o-tax'), 0);
  assert.equal(fixture.get('i-usd-fx').value, '1380');
  assert.equal(fixture.get('inputError').textContent, '');
  assert.match(overseas, /금액·환율·면세 기준·세율은 기능 설명용 예시/);
  assert.match(overseas, /실시간 환율이 아닙니다/);
});

test('overseas blank, negative, nonnumeric, zero and nonfinite required amounts are invalid', () => {
  for (const value of ['', '-120', '120abc', 'Infinity', 'NaN', '0', '1e309']) {
    const fixture = calculator(overseas, 'const currencyEls');
    fixture.set({'i-card': value});
    assertInvalid(fixture);
    assert.equal(fixture.get('i-card').getAttribute('aria-invalid'), 'true');
  }
  for (const [id, value] of [['i-fx',''], ['i-fx','0'], ['i-intl','-25000'], ['i-pay-fee','-3'], ['i-buffer','-1'], ['i-tax-rate',''], ['i-threshold','']]) {
    const fixture = calculator(overseas, 'const currencyEls');
    fixture.set({[id]: value}, id);
    assertInvalid(fixture);
  }
});

test('overseas numeric formatting never turns a negative amount into a positive amount', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  fixture.set({'i-intl': '-25000'}, 'i-intl');
  assert.equal(fixture.get('i-intl').value, '-25000');
  assertInvalid(fixture);
});

test('overseas OFF and always modes explain the selected mode rather than claiming exemption', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  fixture.set({'i-card':'500', 'i-tax-mode':'off', 'i-threshold':'', 'i-tax-rate':''});
  assert.equal(fixture.number('o-tax'), 0);
  assert.match(fixture.get('o-tax-note').textContent, /사용자가 적용 안 함/);
  assert.match(fixture.get('o-tax-note').textContent, /면세 판정이 아/);
  assert.doesNotMatch(fixture.get('o-tax-note').textContent, /기준 이하/);
  fixture.set({'i-tax-mode':'always', 'i-tax-rate':'10'});
  assert.ok(fixture.number('o-tax') > 0);
  assert.match(fixture.get('o-tax-note').textContent, /사용자가 항상 적용/);
});

test('overseas auto tax compares explicit USD amounts with the threshold boundary', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  fixture.set({'i-card':'150','i-local-ship':'0','i-fx':'1000','i-intl':'0','i-pay-fee':'0','i-buffer':'0','i-threshold':'150','i-tax-rate':'10','i-local-price':''});
  assert.equal(fixture.number('o-tax'), 0);
  fixture.set({'i-card':'150.01'});
  assert.equal(fixture.number('o-tax'), 15001);
  fixture.click('btnEurope');
  fixture.set({'i-card':'100','i-local-ship':'0','i-fx':'1500','i-usd-fx':'1000','i-intl':'0','i-pay-fee':'0','i-buffer':'0','i-threshold':'150','i-tax-rate':'10','i-local-price':''});
  assert.equal(fixture.number('o-tax'), 0);
  fixture.set({'i-usd-fx':'999'}, 'i-usd-fx');
  assert.equal(fixture.number('o-tax'), 15000);
  fixture.set({'i-usd-fx':''}, 'i-usd-fx');
  assertInvalid(fixture);
  assert.equal(fixture.get('usd-fx-field').hidden, false);
});

test('overseas currency changes preserve per-currency user FX and require an unseen rate', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  fixture.set({'i-fx':'1420'}, 'i-fx');
  fixture.changeCurrency('EUR');
  assert.equal(fixture.get('i-fx').value, '');
  assertInvalid(fixture);
  fixture.set({'i-fx':'1600','i-usd-fx':'1400'}, 'i-fx');
  fixture.changeCurrency('USD');
  assert.equal(fixture.get('i-fx').value, '1420');
  assert.equal(fixture.get('usd-fx-field').hidden, true);
  fixture.changeCurrency('EUR');
  assert.equal(fixture.get('i-fx').value, '1600');
  assert.equal(fixture.get('cur-symbol1').textContent,'€');
  assert.equal(fixture.get('cur-symbol2').textContent,'€');
  assert.equal(fixture.get('i-fx').getAttribute('aria-describedby'),'fx-help inputError');
  assert.equal(fixture.get('i-card').getAttribute('aria-describedby'),'inputError');
});

test('overseas optional comparison may be blank, while arithmetic overflow clears results', () => {
  const fixture = calculator(overseas, 'const currencyEls');
  fixture.set({'i-local-price':''}, 'i-local-price');
  assert.equal(fixture.get('inputError').textContent, '');
  assert.match(fixture.get('o-compare').textContent, /입력하면 차액/);
  fixture.set({'i-card':'9'.repeat(308), 'i-fx':'9'.repeat(308)});
  assertInvalid(fixture);
  fixture.click('btnReset');
  assertInvalid(fixture);
  assert.equal(fixture.get('i-fx').value, '');
});

test('overseas tests reject the former silent-zero fallback and hidden USD FX', () => {
  const fallback = overseas.replace('return NaN;', 'return 0;');
  const fixture = calculator(fallback, 'const currencyEls');
  fixture.set({'i-intl':'-25000'}, 'i-intl');
  assert.throws(() => assertInvalid(fixture));
  const hiddenFx = overseas.replace("baseKrw / parseNum($('i-usd-fx').value)", 'baseKrw / 1380');
  const hidden = calculator(hiddenFx, 'const currencyEls');
  hidden.click('btnEurope');
  hidden.set({'i-card':'100','i-local-ship':'0','i-fx':'1500','i-usd-fx':'999','i-intl':'0','i-pay-fee':'0','i-buffer':'0','i-threshold':'150','i-tax-rate':'10'});
  assert.notEqual(hidden.number('o-tax'), 15000, 'a hidden reference rate cannot satisfy the explicit-input contract');
});

test('PSA grade-cost help excludes the separately entered shipping and insurance', () => {
  assert.match(psa, /등급료만 확인해 입력하세요\. 대행 수수료와 왕복 배송·보험료는 아래 별도 칸/);
  assert.doesNotMatch(psa, /등급료를 확인한 뒤 배송·보험료를 더해/);
  const fixture = calculator(psa, 'const EXAMPLE');
  assert.equal(fixture.number('oCost'), 550000);
  assert.equal(fixture.number('oBreakeven'), 632184);
  assert.equal(fixture.number('oP10'), 1016000);
  assert.equal(fixture.number('oP9'), 76400);
  assert.equal(fixture.number('oPlow'), -245500);
  fixture.set({'i-ship':'21,000'}, 'i-ship');
  assert.equal(fixture.number('oCost'), 551000, 'shipping is added exactly once');
});

test('PSA pasted decimals, exponent notation, malformed grouping and unsafe integers remain invalid',()=>{
  for(const id of ['i-raw','i-p10','i-grade'])for(const value of ['1.2','1e309','12abc','12,34','-1','9'.repeat(308),'9007199254740992']){
    const fixture=calculator(psa,'const EXAMPLE');fixture.set({[id]:value},id);
    assert.equal(fixture.get(id).value,value,'formatting never changes an invalid amount into a different number');
    assert.equal(fixture.get(id).getAttribute('aria-invalid'),'true');
    assert.equal(fixture.get('oCost').textContent,'입력 확인');
    assert.equal(fixture.get('oBreakeven').textContent,'입력 확인');
    assert.ok(fixture.get('inputError').classList.contains('show'));
  }
  const fixture=calculator(psa,'const EXAMPLE');
  fixture.set({'i-raw':'9007199254740991','i-grade':'9007199254740991'},'i-raw');
  assert.equal(fixture.get('oCost').textContent,'입력 확인','safe individual amounts cannot overflow the sum silently');
  assert.match(fixture.get('inputError').textContent,/안전한 숫자 범위/);
  fixture.click('btnExample');assert.equal(fixture.number('oCost'),550000);
  assert.equal(fixture.get('inputError').classList.contains('show'),false);
  assert.doesNotMatch(psa,/<span class="term-prompt">\$<\/span><input id="i-/);
});

test('PSA narrow grid and flex inputs can shrink inside their panel without clipping content',()=>{
  const assertMobile=source=>{
    const owner=source.match(/<style id="cp-tool-finish-usability">([\s\S]*?)<\/style>/)[1];
    assert.match(owner,/@media\(max-width:720px\)\{[^\n]*\.term-inner \.form-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(owner,/\.term-inner \.field,\.term-inner \.field-row\{min-width:0;max-width:100%\}/);
    assert.match(owner,/\.term-inner \.field-row input\{font-size:16px;min-width:0;width:0\}/);
    assert.doesNotMatch(owner,/overflow(?:-x)?:hidden|clip-path/);
  };
  assertMobile(psa);
  assert.throws(()=>assertMobile(psa.replace('grid-template-columns:minmax(0,1fr)','grid-template-columns:1fr')));
  assert.throws(()=>assertMobile(psa.replace('.term-inner .field,.term-inner .field-row{min-width:0;max-width:100%}','.term-inner .field,.term-inner .field-row{min-width:auto;max-width:100%}')));
  assert.throws(()=>assertMobile(psa.replace('font-size:16px;min-width:0;width:0','font-size:16px;min-width:0;width:240px')));
});

test('overseas narrow fields and selects stay inside the grid instead of being hidden by body clipping',()=>{
  const assertMobile=source=>{
    const owner=source.match(/<style id="cp-tool-finish-usability">([\s\S]*?)<\/style>/)[1];
    assert.match(owner,/@media\(max-width:720px\)\{[^\n]*\.term-inner \.form-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(owner,/\.term-inner \.field,\.term-inner \.field-row\{min-width:0;max-width:100%\}/);
    assert.match(owner,/\.term-inner \.field-row input\{font-size:16px;min-width:0;width:0\}/);
    assert.match(owner,/\.term-inner \.field-row select\{font-size:16px;min-width:0;width:100%;max-width:100%\}/);
    assert.doesNotMatch(owner,/overflow(?:-x)?:hidden|clip-path/);
  };
  assertMobile(overseas);
  assert.throws(()=>assertMobile(overseas.replace('grid-template-columns:minmax(0,1fr)','grid-template-columns:1fr')));
  assert.throws(()=>assertMobile(overseas.replace('font-size:16px;min-width:0;width:0','font-size:16px;min-width:auto;width:240px')));
  assert.throws(()=>assertMobile(overseas.replace('font-size:16px;min-width:0;width:100%;max-width:100%','font-size:16px;min-width:280px;width:100%;max-width:none')));
});

test('tool fonts are optional nonblocking with noscript and approved scripts keep their order',()=>{
  for(const [name,source] of [['centering-checker',centering],['overseas-card-cost',overseas],['psa-grading-break-even',psa]]){
    assertOptionalFonts(source);
    assert.throws(()=>assertOptionalFonts(source.replace('media="print"','media="all"')));
    assert.throws(()=>assertOptionalFonts(source.replace('<noscript>','<template>')));
    const order=html=>[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map(match=>match[1]);
    assert.deepEqual(order(source),order(before('tools/'+name+'.html')));
  }
  assert.match(overseas,/<script src="\/auth\.js\?v=v3clean" defer><\/script>/);
  assert.match(psa,/<script src="\/auth\.js\?v=v3clean" defer><\/script>\s*<script src="\/search\.js\?v=20260519ko" defer><\/script>/);
  for(const source of [centering,psa])assert.match(source,/도구 페이지 주소만 공유합니다/);
});

test('PSA preserves the existing autocomplete mount and adds a separate catalog destination',()=>{
  const header=psa.match(/<header\b[\s\S]*?<\/header>/)[0];
  const originalHeader=before('tools/psa-grading-break-even.html').match(/<header\b[\s\S]*?<\/header>/)[0];
  assert.equal(header.match(/<label class="cp-search"[\s\S]*?<\/label>/)[0],originalHeader.match(/<label class="cp-search"[\s\S]*?<\/label>/)[0]);
  assert.match(header,/<a href="\/catalog">카드 검색<\/a>/);
  const shared=read('search.js');
  assert.equal(createHash('sha256').update(restoreGrowth17(shared,'search.js')).digest('hex'),'0607261d3c6530738ca37589354378b077ab363d7cbb517055867013a61c2800','only the separately approved search-intent patch and exact grading bridge are accepted');
  const ensureInput=shared.slice(shared.indexOf('  function ensureInput()'),shared.indexOf('  ready(function ()'));
  const priorShared=before('search.js');
  const priorMount=priorShared.slice(priorShared.indexOf('  function ensureInput()'),priorShared.indexOf('  ready(function ()'));
  assert.equal(ensureInput,priorMount,'existing header autocomplete mount bytes remain unchanged');
  const bar={innerHTML:'',style:{},appendChild(node){this.dropdown=node;}};
  const document={getElementById:()=>null,querySelector:()=>bar,createElement:()=>({style:{}})};
  const context={document,getComputedStyle:()=>({position:'static'})};
  vm.runInNewContext(ensureInput+'\nglobalThis.mounted=ensureInput();',context,{timeout:2000});
  assert.equal(context.mounted,true);
  assert.match(bar.innerHTML,/<input id="cp-search" type="search"/);
  assert.equal(bar.dropdown.id,'cp-search-results');
  assert.match(header,/<a href="\/login" class="cp-login-google"/);
});

test('tool SEO policy, headers, font resources, advertisements and existing sharing remain unchanged', () => {
  for (const name of ['centering-checker','overseas-card-cost','psa-grading-break-even']) {
    const file = 'tools/' + name + '.html', source = normalizeToolResults(read(file),name), original = before(file);
    let protectedSource = source;
    if (name === 'centering-checker') {
      assertCenterContent(source);
      for (const [attribute, description] of centerDescriptionCopies) {
        const approved = '<meta ' + attribute + ' content="' + description + '">';
        assert.equal(protectedSource.split(approved).length - 1, 1);
        protectedSource = protectedSource.replace(approved, metaTag(original, attribute));
      }
    }
    const optionalFont=assertOptionalFonts(source);
    const originalFont=[...original.matchAll(/<link\b[^>]*>/g)].find(match=>match[0].includes('family=JetBrains'))[0];
    protectedSource=protectedSource.replace(optionalFont,originalFont);
    if(name!=='centering-checker')protectedSource=protectedSource.replace('<script src="/auth.js?v=v3clean" defer></script>','<script src="/auth.js?v=v3clean"></script>');
    if(name==='psa-grading-break-even'){
      protectedSource=protectedSource.replace('<script src="/search.js?v=20260519ko" defer></script>','<script src="/search.js?v=20260519ko"></script>');
      const originalHeader=original.match(/<header\b[\s\S]*?<\/header>/)[0];
      const expectedHeader=originalHeader
        .replace('<a href="/#prices">카드 시세</a>','<a href="/#prices">카드 시세</a>\n      <a href="/catalog">카드 검색</a>')
        .replace('<button type="button" class="cp-login-google" aria-label="Google 계정으로 로그인">','<a href="/login" class="cp-login-google" aria-label="Google 계정으로 로그인">')
        .replace('</button>','</a>');
      assert.equal(source.match(/<header\b[\s\S]*?<\/header>/)[0],expectedHeader);
      protectedSource=protectedSource.replace(expectedHeader,originalHeader);
    }
    const protectedBlocks = html => [
      html.match(/<header\b[\s\S]*?<\/header>/)[0],
      ...[...html.matchAll(/<meta\b[^>]*>|<link\b[^>]*>|<script\b[^>]*src=[^>]*><\/script>/g)].map(match => match[0]),
    ];
    assert.deepEqual(protectedBlocks(protectedSource), protectedBlocks(original));
    if (name !== 'overseas-card-cost') assert.match(source, /onclick="cpShare\(\)"/);
    assert.doesNotMatch(source, /URLSearchParams|sessionStorage|localStorage|gtag\(['"]event/);
  }
});

test('results normalization rejects altered, duplicated and relocated panels or unapproved script changes',()=>{
  for(const [name,[tool]] of Object.entries(resultsPanels)){
    const source=read('tools/'+name+'.html'),baseline=normalizeToolResults(source,name);
    const panel=source.match(new RegExp('    <!-- calculator-results start: '+tool+' -->[\\s\\S]*?    <!-- calculator-results end: '+tool+' -->\\n'))[0];
    for(const changed of [source.replace(panel,panel+panel),source.replace(panel,panel.replace('확인한 조건 적용','자동 적용')),source.replace(panel,'').replace('</body>',panel+'</body>'),source.replace('</body>','<script>unapproved()</script></body>'),source.replace('rel="canonical"','rel="wrong"')]){
      assert.notEqual(changed,source);
      assert.throws(()=>assert.equal(normalizeToolResults(changed,name),baseline));
    }
  }
});
test('growth22 PNG exceptions reject altered, duplicate, moved blocks and A-label or SEO drift',()=>{
  for(const name of Object.keys(resultsPanels)){
    const source=read('tools/'+name+'.html'),baseline=normalizeToolResults(source,name);
    const button=source.match(/        <!-- calculator-png button start -->\n[\s\S]*?        <!-- calculator-png button end -->\n/)[0];
    const fallback=source.match(/      <!-- calculator-png fallback start -->\n[\s\S]*?      <!-- calculator-png fallback end -->\n/)[0];
    for(const changed of [
      source.replace(button,button+button),
      source.replace(button,button.replace('PNG 저장','PNG 외부 전송')),
      source.replace(button,'').replace('      <!-- calculator-png fallback start -->',button+'      <!-- calculator-png fallback start -->'),
      source.replace(fallback,'').replace('</body>',fallback+'</body>'),
      source.replace(fallback,fallback.replace('브라우저','외부 서버')),
      source.replace('복사·저장할 내용에 조건 A도 포함','자동 저장'),
      source.replace('rel="canonical"','rel="unapproved"'),
    ]){
      assert.notEqual(changed,source);
      assert.throws(()=>assert.equal(normalizeToolResults(changed,name),baseline));
    }
  }
});
